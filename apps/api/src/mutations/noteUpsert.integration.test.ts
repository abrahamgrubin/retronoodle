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

describe.skipIf(!hasLiveEnv)('typed topic notes against a live Supabase project (RN-020)', () => {
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
    const email = `rn020-${label}-${randomUUID()}@example.com`;
    const password = `Rn020-${randomUUID()}!`;
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

  // Advances a fresh single-card-topic retro all the way to Discuss, where its one topic is
  // already current (top-voted, per RN-018's vote->discuss).
  async function createRetroInDiscuss(token: string, userId: string) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name: `RN-020 retro ${retroId}`, templateId },
    });
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: userId });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;

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

    const email = `rn020-owner-${randomUUID()}@example.com`;
    const password = `Rn020-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-020 notes test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('writes notes, overwrites on a second call, and anyone (not just the facilitator) may do it', async () => {
    const owner = await createTeamMember('writer');
    const { retroId, topicId } = await createRetroInDiscuss(owner.token, owner.userId);
    const other = await createTeamMember('other-writer');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: other.userId });

    const first = await sendMutation(owner.token, retroId, 'note.upsert', { topicId, body: 'First draft.' });
    expect(first.statusCode).toBe(200);
    expect(first.json().result).toMatchObject({ topic: { id: topicId, notes: 'First draft.' } });

    const second = await sendMutation(other.token, retroId, 'note.upsert', { topicId, body: 'Overwritten by someone else.' });
    expect(second.statusCode).toBe(200);
    expect(second.json().result).toMatchObject({ topic: { notes: 'Overwritten by someone else.' } });

    const { data: row } = await admin.from('topic_notes').select('body').eq('topic_id', topicId).single();
    expect(row!.body).toBe('Overwritten by someone else.');
  });

  it('rejects outside Discuss/Wrap up', async () => {
    const { userId, token } = await createTeamMember('gate');
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name: `RN-020 gate retro ${retroId}`, templateId },
    });
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: userId });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;
    const cardId = randomUUID();
    await sendMutation(token, retroId, 'card.create', { cardId, columnId, body: 'Solo card' });
    await sendMutation(token, retroId, 'phase.next'); // write -> group
    const { data: topics } = await admin.from('topics').select('id').eq('retro_id', retroId);
    const topicId = topics![0]?.id ?? randomUUID();

    const rejected = await sendMutation(token, retroId, 'note.upsert', { topicId, body: 'Too early.' });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe('phase_not_allowed');
  });

  // RN-020 AC: "Notes save automatically and appear for everyone."
  it("a bystander's realtime broadcast carries the real note body", async () => {
    const owner = await createTeamMember('sync-owner');
    const { retroId, topicId } = await createRetroInDiscuss(owner.token, owner.userId);
    const bystander = await createTeamMember('sync-bystander');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: bystander.userId });

    const listener = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await listener.auth.setSession({ access_token: bystander.token, refresh_token: 'unused' }).catch(() => {});
    const retroChannel = listener.channel(`retro:${retroId}`, { config: { private: true } });
    const broadcastPayload = new Promise<{ seq: number; result: unknown }>((resolve) => {
      retroChannel.on('broadcast', { event: 'note.upsert' }, (msg) => resolve(msg.payload as never));
    });
    await new Promise<void>((resolve) => retroChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve()));

    const result = await sendMutation(owner.token, retroId, 'note.upsert', { topicId, body: 'Visible to everyone.' });
    expect(result.statusCode).toBe(200);

    const broadcast = await broadcastPayload;
    expect(broadcast.result).toMatchObject({ topic: { id: topicId, notes: 'Visible to everyone.' } });

    await listener.removeChannel(retroChannel);
  }, 15000);
}, 30000);
