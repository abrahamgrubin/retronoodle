import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { generateKeyBetween } from 'fractional-indexing';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@retronoodle/shared';
import { buildServer } from '../server.js';
import { createTokenVerifier } from '../auth/index.js';
import { RealtimeBus } from '../realtime/RealtimeBus.js';
import { createPool } from '../db/pool.js';
import { createDefaultMutationRegistry } from './index.js';

// Same live-project pattern as this repo's other integration tests.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('the discuss queue against a live Supabase project (RN-019)', () => {
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

  // Fresh team member per test (same rate-limit-avoidance pattern as every other integration
  // test file in this repo — see votes.integration.test.ts's own comment).
  async function createTeamMember(label: string) {
    const email = `rn019-${label}-${randomUUID()}@example.com`;
    const password = `Rn019-${randomUUID()}!`;
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

  // The caller becomes the retro's facilitator. Three solo-card topics (no manual grouping
  // needed — group->vote auto-creates one per leftover card), voted so entering Discuss ranks
  // them high/mid/low — "high" is top-voted and becomes current the moment Discuss starts.
  async function createRetroInDiscuss(facilitatorToken: string, facilitatorUserId: string) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
      payload: { id: retroId, name: `RN-019 retro ${retroId}`, templateId },
    });
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: facilitatorUserId });

    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;

    const cardHighId = randomUUID();
    const cardMidId = randomUUID();
    const cardLowId = randomUUID();
    await sendMutation(facilitatorToken, retroId, 'card.create', { cardId: cardHighId, columnId, body: 'High votes' });
    await sendMutation(facilitatorToken, retroId, 'card.create', { cardId: cardMidId, columnId, body: 'Mid votes' });
    await sendMutation(facilitatorToken, retroId, 'card.create', { cardId: cardLowId, columnId, body: 'Low votes' });
    await sendMutation(facilitatorToken, retroId, 'phase.next'); // write -> group
    await sendMutation(facilitatorToken, retroId, 'phase.next'); // group -> vote: three solo topics

    const { data: topics } = await admin.from('topics').select('id, name').eq('retro_id', retroId);
    const high = topics!.find((t) => t.name === 'High votes')!.id;
    const mid = topics!.find((t) => t.name === 'Mid votes')!.id;
    const low = topics!.find((t) => t.name === 'Low votes')!.id;

    await sendMutation(facilitatorToken, retroId, 'vote.add', { topicId: high });
    await sendMutation(facilitatorToken, retroId, 'vote.add', { topicId: high });
    await sendMutation(facilitatorToken, retroId, 'vote.add', { topicId: mid });

    await sendMutation(facilitatorToken, retroId, 'phase.next'); // vote -> discuss

    return { retroId, high, mid, low };
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

    const email = `rn019-owner-${randomUUID()}@example.com`;
    const password = `Rn019-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-019 discuss queue test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('topic.next walks the queue in vote order, stamping startedAt/endedAt, and ends with nothing current', async () => {
    const { userId, token } = await createTeamMember('next');
    const { retroId, high, mid, low } = await createRetroInDiscuss(token, userId);

    const first = await sendMutation(token, retroId, 'topic.next');
    expect(first.statusCode).toBe(200);
    expect(first.json().result).toMatchObject({
      endedTopic: { id: high, endedAt: expect.any(String) },
      startedTopic: { id: mid, startedAt: expect.any(String) },
    });

    const second = await sendMutation(token, retroId, 'topic.next');
    expect(second.json().result).toMatchObject({ endedTopic: { id: mid }, startedTopic: { id: low } });

    const last = await sendMutation(token, retroId, 'topic.next'); // "Finish discussion"
    expect(last.json().result).toMatchObject({ endedTopic: { id: low }, startedTopic: null });

    const { data: rows } = await admin.from('topics').select('id, started_at, ended_at').eq('retro_id', retroId);
    for (const row of rows!) {
      expect(row.started_at).not.toBeNull();
      expect(row.ended_at).not.toBeNull();
    }
  });

  it('topic.setCurrent jumps anywhere, including reopening an already-discussed topic', async () => {
    const { userId, token } = await createTeamMember('jump');
    const { retroId, high, low } = await createRetroInDiscuss(token, userId);

    // Jump straight to "low", skipping "mid" entirely.
    const jump = await sendMutation(token, retroId, 'topic.setCurrent', { topicId: low });
    expect(jump.json().result).toMatchObject({ endedTopic: { id: high }, startedTopic: { id: low } });

    // Jump back to "high", which was already discussed — this reopens it.
    const reopen = await sendMutation(token, retroId, 'topic.setCurrent', { topicId: high });
    expect(reopen.json().result).toMatchObject({ endedTopic: { id: low }, startedTopic: { id: high, endedAt: null } });

    const { data: highRow } = await admin.from('topics').select('started_at, ended_at').eq('id', high).single();
    expect(highRow!.ended_at).toBeNull();
    expect(highRow!.started_at).not.toBeNull();
  });

  it('queue.reorder changes up-next order and rejects a topic that already started', async () => {
    const { userId, token } = await createTeamMember('reorder');
    const { retroId, mid, low } = await createRetroInDiscuss(token, userId);

    const { data: midRow } = await admin.from('topics').select('discussion_order').eq('id', mid).single();
    const newOrder = generateKeyBetween(null, midRow!.discussion_order); // moves "low" ahead of "mid"

    const reorder = await sendMutation(token, retroId, 'queue.reorder', { topicId: low, discussionOrder: newOrder });
    expect(reorder.statusCode).toBe(200);
    expect(reorder.json().result).toMatchObject({ topic: { id: low, discussionOrder: newOrder } });

    const next = await sendMutation(token, retroId, 'topic.next'); // ends "high", starts the new front of the queue
    expect(next.json().result).toMatchObject({ startedTopic: { id: low } });

    const rejected = await sendMutation(token, retroId, 'queue.reorder', { topicId: low, discussionOrder: 'zz' });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe('already_started');
  });

  it('rejects a non-facilitator and rejects outside Discuss', async () => {
    const { userId, token } = await createTeamMember('gate-owner');
    const { retroId } = await createRetroInDiscuss(token, userId);
    const other = await createTeamMember('gate-other');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: other.userId });

    const forbidden = await sendMutation(other.token, retroId, 'topic.next');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error).toBe('forbidden');

    await sendMutation(token, retroId, 'phase.next'); // discuss -> wrap_up (queue empties out via "Finish" path isn't needed here)
    const outsideDiscuss = await sendMutation(token, retroId, 'topic.next');
    expect(outsideDiscuss.statusCode).toBe(409);
    expect(outsideDiscuss.json().error).toBe('phase_not_allowed');
  });

  // RN-019 AC: "Next, jump and drag-reorder sync to all browsers."
  it("a bystander's realtime broadcast carries the same topic.next result", async () => {
    const owner = await createTeamMember('sync-owner');
    const { retroId, high, mid } = await createRetroInDiscuss(owner.token, owner.userId);
    const bystander = await createTeamMember('sync-bystander');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: bystander.userId });

    const listener = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await listener.auth.setSession({ access_token: bystander.token, refresh_token: 'unused' }).catch(() => {});
    const retroChannel = listener.channel(`retro:${retroId}`, { config: { private: true } });
    const broadcastPayload = new Promise<{ seq: number; result: unknown }>((resolve) => {
      retroChannel.on('broadcast', { event: 'topic.next' }, (msg) => resolve(msg.payload as never));
    });
    await new Promise<void>((resolve) => retroChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve()));

    const result = await sendMutation(owner.token, retroId, 'topic.next');
    expect(result.statusCode).toBe(200);

    const broadcast = await broadcastPayload;
    expect(broadcast.result).toMatchObject({ endedTopic: { id: high }, startedTopic: { id: mid } });

    await listener.removeChannel(retroChannel);
  }, 15000);
}, 30000);
