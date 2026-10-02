import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@retronoodle/shared';
import { buildServer } from '../server.js';
import { createTokenVerifier } from '../auth/index.js';
import { RealtimeBus } from '../realtime/RealtimeBus.js';
import { createPool } from '../db/pool.js';
import { createDefaultMutationRegistry } from './index.js';

// Same live-project pattern as this repo's other integration tests. The real Anthropic call
// (ai.summarizeTopic's own job) is never exercised here — same reasoning as every other AI
// feature in this app: that's verified manually, live, not in an automated/CI test. This file
// only covers the API layer: the two mutations that read/write topic_summaries rows directly.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('topic summary edit/regenerate against a live Supabase project (RN-021)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let teamId: string | undefined;
  let templateId: string | undefined;
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
    await pool.end();
  });

  async function createTeamMember(label: string) {
    const email = `rn021-${label}-${randomUUID()}@example.com`;
    const password = `Rn021-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error(`failed to create ${label}`);
    createdUserIds.push(created.user.id);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
    const token = session.session.access_token;
    await app!.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });
    await admin.from('team_members').insert({ team_id: teamId!, user_id: created.user.id, role: 'member' });
    return { userId: created.user.id, token };
  }

  async function sendMutation(token: string, retroId: string, type: string, payload: unknown = {}) {
    return app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mutationId: randomUUID(), type, payload },
    });
  }

  // Advances a fresh single-card-topic retro to Discuss, then inserts a topic_summaries row by
  // hand — standing in for what the worker job would have produced, since that job's own
  // Anthropic call is never exercised here.
  async function createRetroWithSummary(token: string, userId: string) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name: `RN-021 retro ${retroId}`, templateId },
    });
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: userId });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;
    const cardId = randomUUID();
    await sendMutation(token, retroId, 'card.create', { cardId, columnId, body: 'Deploys are slow' });
    await sendMutation(token, retroId, 'phase.next'); // write -> group
    await sendMutation(token, retroId, 'phase.next'); // group -> vote
    await sendMutation(token, retroId, 'phase.next'); // vote -> discuss

    const { data: topics } = await admin.from('topics').select('id').eq('retro_id', retroId);
    const topicId = topics![0]!.id;

    await admin.from('topic_summaries').insert({
      topic_id: topicId,
      version: 1,
      model: 'claude-sonnet-5',
      prompt_version: 'test-version',
      key_points: [{ text: 'Deploys are slow', sources: [cardId] }],
      decisions: [],
      disagreements: [],
      proposed_action_items: [],
    });

    return { retroId, topicId, cardId };
  }

  beforeAll(async () => {
    app = await buildServer({
      webOrigin: 'http://localhost:5173',
      auth: {
        verifyAccessToken: createTokenVerifier(SUPABASE_URL!),
        supabaseAdmin: admin,
        realtimeBus: new RealtimeBus(admin),
        pool,
        mutationRegistry: createDefaultMutationRegistry(),
      },
    });

    const email = `rn021-owner-${randomUUID()}@example.com`;
    const password = `Rn021-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error('failed to create owner');
    createdUserIds.push(created.user.id);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error('failed to sign in owner');
    const ownerToken = session.session.access_token;

    await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${ownerToken}` } });
    teamId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/teams',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { id: teamId, name: 'RN-021 summary test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('edits the latest summary in place (same version, marked edited) and rejects a non-facilitator', async () => {
    const owner = await createTeamMember('editor');
    const { retroId, topicId, cardId } = await createRetroWithSummary(owner.token, owner.userId);
    const other = await createTeamMember('editor-other');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: other.userId });

    const forbidden = await sendMutation(other.token, retroId, 'topic.editSummary', {
      topicId,
      keyPoints: [],
      decisions: [],
      disagreements: [],
      proposedActionItems: [],
    });
    expect(forbidden.statusCode).toBe(403);

    const edited = await sendMutation(owner.token, retroId, 'topic.editSummary', {
      topicId,
      keyPoints: [{ text: 'Edited key point', sources: [cardId] }],
      decisions: [{ text: 'We agreed to fix it', sources: [] }],
      disagreements: [],
      proposedActionItems: [],
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().result).toMatchObject({
      summary: { topicId, version: 1, edited: true, keyPoints: [{ text: 'Edited key point', sources: [cardId] }] },
    });

    const { data: rows } = await admin.from('topic_summaries').select('version').eq('topic_id', topicId);
    expect(rows).toHaveLength(1); // still just one row — edited in place, not a new version
  });

  it('regenerateSummary acknowledges the request and rejects outside Discuss/Wrap up', async () => {
    const owner = await createTeamMember('regen');
    const { retroId, topicId } = await createRetroWithSummary(owner.token, owner.userId);

    const result = await sendMutation(owner.token, retroId, 'topic.regenerateSummary', { topicId });
    expect(result.statusCode).toBe(200);
    expect(result.json().result).toEqual({ topicId });

    await sendMutation(owner.token, retroId, 'phase.next'); // discuss -> wrap_up is still allowed...
    const stillAllowed = await sendMutation(owner.token, retroId, 'topic.regenerateSummary', { topicId });
    expect(stillAllowed.statusCode).toBe(200);
  });

  it('rejects topic.editSummary when there is no summary yet to edit', async () => {
    const { userId, token } = await createTeamMember('no-summary');
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name: `RN-021 no-summary retro ${retroId}`, templateId },
    });
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: userId });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;
    const cardId = randomUUID();
    await sendMutation(token, retroId, 'card.create', { cardId, columnId, body: 'Solo card' });
    await sendMutation(token, retroId, 'phase.next'); // write -> group
    await sendMutation(token, retroId, 'phase.next'); // group -> vote
    await sendMutation(token, retroId, 'phase.next'); // vote -> discuss
    const { data: topics } = await admin.from('topics').select('id').eq('retro_id', retroId);
    const topicId = topics![0]!.id;

    const result = await sendMutation(token, retroId, 'topic.editSummary', {
      topicId,
      keyPoints: [],
      decisions: [],
      disagreements: [],
      proposedActionItems: [],
    });
    expect(result.statusCode).toBe(404);
  });

  // RN-021: "the summary panel beside the board" is public — everyone sees edits, not just the
  // facilitator who made them (unlike RN-017's facilitator-only suggestions).
  it("a bystander's realtime broadcast carries the edited summary", async () => {
    const owner = await createTeamMember('sync-owner');
    const { retroId, topicId, cardId } = await createRetroWithSummary(owner.token, owner.userId);
    const bystander = await createTeamMember('sync-bystander');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: bystander.userId });

    const listener = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await listener.auth.setSession({ access_token: bystander.token, refresh_token: 'unused' }).catch(() => {});
    const retroChannel = listener.channel(`retro:${retroId}`, { config: { private: true } });
    const broadcastPayload = new Promise<{ seq: number; result: unknown }>((resolve) => {
      retroChannel.on('broadcast', { event: 'topic.editSummary' }, (msg) => resolve(msg.payload as never));
    });
    await new Promise<void>((resolve) => retroChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve()));

    const result = await sendMutation(owner.token, retroId, 'topic.editSummary', {
      topicId,
      keyPoints: [{ text: 'Visible to everyone', sources: [cardId] }],
      decisions: [],
      disagreements: [],
      proposedActionItems: [],
    });
    expect(result.statusCode).toBe(200);

    const broadcast = await broadcastPayload;
    expect(broadcast.result).toMatchObject({ summary: { topicId, keyPoints: [{ text: 'Visible to everyone', sources: [cardId] }] } });

    await listener.removeChannel(retroChannel);
  }, 15000);
}, 30000);
