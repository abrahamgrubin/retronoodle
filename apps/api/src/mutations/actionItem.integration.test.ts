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

// Same live-project pattern as this repo's other integration tests.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('action items against a live Supabase project (RN-022)', () => {
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
    const email = `rn022-${label}-${randomUUID()}@example.com`;
    const password = `Rn022-${randomUUID()}!`;
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

  async function createRetro(token: string, userId: string) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name: `RN-022 retro ${retroId}`, templateId },
    });
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: userId });
    return retroId;
  }

  // Advances a fresh single-card-topic retro all the way to Discuss, where its one topic is
  // already current (top-voted, per RN-018's vote->discuss) — same helper shape as RN-020/RN-021's
  // own integration tests.
  async function createRetroInDiscuss(token: string, userId: string) {
    const retroId = await createRetro(token, userId);
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;

    await sendMutation(token, retroId, 'phase.next'); // review -> write
    const cardId = randomUUID();
    await sendMutation(token, retroId, 'card.create', { cardId, columnId, body: 'Solo card' });
    await sendMutation(token, retroId, 'phase.next'); // write -> group
    await sendMutation(token, retroId, 'phase.next'); // group -> vote: one solo topic
    await sendMutation(token, retroId, 'phase.next'); // vote -> discuss: it becomes current

    const { data: topics } = await admin.from('topics').select('id').eq('retro_id', retroId);
    return { retroId, topicId: topics![0]!.id };
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

    const email = `rn022-owner-${randomUUID()}@example.com`;
    const password = `Rn022-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-022 action items test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('creates a manual action item directly in Review, with no source topic', async () => {
    const owner = await createTeamMember('review-create');
    // retros.ts: "starts in Review if the team has carried-over action items still open ... Write
    // otherwise" — a fresh team has none, so a prior open item has to exist for the new retro to
    // land in Review at all.
    const priorRetroId = randomUUID();
    await admin.from('retros').insert({
      id: priorRetroId,
      team_id: teamId!,
      facilitator_id: owner.userId,
      template_id: templateId!,
      template_source: 'builtin',
      name: 'Prior retro',
      phase: 'closed',
      join_code_hash: randomUUID(),
    });
    await admin
      .from('action_items')
      .insert({ id: randomUUID(), team_id: teamId!, source_retro_id: priorRetroId, title: 'Carried over', status: 'open', origin: 'manual' });

    const retroId = await createRetro(owner.token, owner.userId);
    const { data: freshRetro } = await admin.from('retros').select('phase').eq('id', retroId).single();
    expect(freshRetro!.phase).toBe('review');
    const actionItemId = randomUUID();

    const created = await sendMutation(owner.token, retroId, 'actionItem.create', {
      id: actionItemId,
      title: 'Write up the migration runbook',
      sourceTopicId: null,
      ownerId: null,
      dueDate: null,
      origin: 'manual',
    });

    expect(created.statusCode).toBe(200);
    expect(created.json().result).toMatchObject({
      actionItem: { id: actionItemId, sourceRetroId: retroId, sourceTopicId: null, status: 'open', origin: 'manual' },
    });

    const { data: row } = await admin.from('action_items').select().eq('id', actionItemId).single();
    expect(row).toMatchObject({ source_retro_id: retroId, source_topic_id: null, status: 'open', origin: 'manual' });
  });

  it('"Add as action item" pre-fills the source topic, and owner/due date edits round-trip', async () => {
    const owner = await createTeamMember('ai-create');
    const { retroId, topicId } = await createRetroInDiscuss(owner.token, owner.userId);
    const teammate = await createTeamMember('ai-owner');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: teammate.userId });
    const actionItemId = randomUUID();

    const created = await sendMutation(owner.token, retroId, 'actionItem.create', {
      id: actionItemId,
      title: 'Automate the deploy checklist',
      sourceTopicId: topicId,
      ownerId: null,
      dueDate: null,
      origin: 'ai',
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().result).toMatchObject({ actionItem: { sourceTopicId: topicId, origin: 'ai' } });

    const updated = await sendMutation(owner.token, retroId, 'actionItem.update', {
      id: actionItemId,
      ownerId: teammate.userId,
      dueDate: '2026-03-15',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().result).toMatchObject({ actionItem: { ownerId: teammate.userId, dueDate: '2026-03-15' } });

    const { data: row } = await admin.from('action_items').select('owner_id, due_date, title').eq('id', actionItemId).single();
    expect(row).toMatchObject({ owner_id: teammate.userId, due_date: '2026-03-15', title: 'Automate the deploy checklist' });
  });

  it('rejects creation outside Review, Discuss and Wrap up', async () => {
    const owner = await createTeamMember('gate');
    const retroId = await createRetro(owner.token, owner.userId);
    await sendMutation(owner.token, retroId, 'phase.next'); // review -> write

    const rejected = await sendMutation(owner.token, retroId, 'actionItem.create', {
      id: randomUUID(),
      title: 'Too early',
      sourceTopicId: null,
      ownerId: null,
      dueDate: null,
      origin: 'manual',
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe('phase_not_allowed');
  });

  // RN-022 AC: "Owner and due date changes sync to all browsers." Action items aren't hidden or
  // facilitator-only, so this is a plain visibility check, not a redaction check.
  it("a bystander's realtime broadcast carries the real action item", async () => {
    const owner = await createTeamMember('sync-owner');
    const retroId = await createRetro(owner.token, owner.userId);
    const bystander = await createTeamMember('sync-bystander');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: bystander.userId });

    const listener = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await listener.auth.setSession({ access_token: bystander.token, refresh_token: 'unused' }).catch(() => {});
    const retroChannel = listener.channel(`retro:${retroId}`, { config: { private: true } });
    const broadcastPayload = new Promise<{ seq: number; result: unknown }>((resolve) => {
      retroChannel.on('broadcast', { event: 'actionItem.create' }, (msg) => resolve(msg.payload as never));
    });
    await new Promise<void>((resolve) => retroChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve()));

    const actionItemId = randomUUID();
    const result = await sendMutation(owner.token, retroId, 'actionItem.create', {
      id: actionItemId,
      title: 'Visible to everyone',
      sourceTopicId: null,
      ownerId: null,
      dueDate: null,
      origin: 'manual',
    });
    expect(result.statusCode).toBe(200);

    const broadcast = await broadcastPayload;
    expect(broadcast.result).toMatchObject({ actionItem: { id: actionItemId, title: 'Visible to everyone' } });

    await listener.removeChannel(retroChannel);
  }, 15000);
}, 30000);
