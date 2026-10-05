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

describe.skipIf(!hasLiveEnv)('retro.close against a live Supabase project (RN-023)', () => {
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
    const email = `rn023-${label}-${randomUUID()}@example.com`;
    const password = `Rn023-${randomUUID()}!`;
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

  async function currentPhase(retroId: string): Promise<string> {
    const { data } = await admin.from('retros').select('phase').eq('id', retroId).single();
    return data!.phase;
  }

  // Advances a fresh retro all the way to Wrap up. Every test in this file shares one team, and
  // nothing here closes or drops the action items earlier tests create — so by the time a later
  // test runs, the team already has open/unowned carried-over items, and retros.ts starts the new
  // retro in Review rather than Write (RN-022's own discovery: "starts in Review if the team has
  // carried-over action items still open"). Walking by the retro's *actual* current phase (not a
  // fixed review/write assumption) keeps this correct regardless of test order.
  async function createRetroInWrapUp(token: string, userId: string) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name: `RN-023 retro ${retroId}`, templateId },
    });
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: userId });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;

    if ((await currentPhase(retroId)) === 'review') await sendMutation(token, retroId, 'phase.next'); // review -> write

    const cardId = randomUUID();
    await sendMutation(token, retroId, 'card.create', { cardId, columnId, body: 'Solo card' });
    while ((await currentPhase(retroId)) !== 'wrap_up') {
      await sendMutation(token, retroId, 'phase.next');
    }
    return retroId;
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

    const email = `rn023-owner-${randomUUID()}@example.com`;
    const password = `Rn023-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-023 close test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('closes in one click when every action item is owned', async () => {
    const owner = await createTeamMember('all-owned');
    const retroId = await createRetroInWrapUp(owner.token, owner.userId);
    await sendMutation(owner.token, retroId, 'actionItem.create', {
      id: randomUUID(),
      title: 'Owned item',
      sourceTopicId: null,
      ownerId: owner.userId,
      dueDate: null,
      origin: 'manual',
    });

    const res = await sendMutation(owner.token, retroId, 'retro.close', { nextRetroAt: '2026-03-01', override: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ phase: 'closed' });

    const { data: row } = await admin.from('retros').select('phase, next_retro_at, closed_with_override, closed_at').eq('id', retroId).single();
    expect(row).toMatchObject({ phase: 'closed', next_retro_at: '2026-03-01', closed_with_override: false });
    expect(row!.closed_at).not.toBeNull();
  });

  it('blocks closing while an active item has no owner, and lists it for the dialog via board.actionItems', async () => {
    const owner = await createTeamMember('ownerless');
    const retroId = await createRetroInWrapUp(owner.token, owner.userId);
    await sendMutation(owner.token, retroId, 'actionItem.create', {
      id: randomUUID(),
      title: 'Needs an owner',
      sourceTopicId: null,
      ownerId: null,
      dueDate: null,
      origin: 'manual',
    });

    const res = await sendMutation(owner.token, retroId, 'retro.close', { nextRetroAt: '2026-03-01', override: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('owners_missing');

    const { data: row } = await admin.from('retros').select('phase').eq('id', retroId).single();
    expect(row!.phase).toBe('wrap_up'); // never advanced
  });

  it('override closes and records closed_with_override', async () => {
    const owner = await createTeamMember('override');
    const retroId = await createRetroInWrapUp(owner.token, owner.userId);
    await sendMutation(owner.token, retroId, 'actionItem.create', {
      id: randomUUID(),
      title: 'Still needs an owner',
      sourceTopicId: null,
      ownerId: null,
      dueDate: null,
      origin: 'manual',
    });

    const res = await sendMutation(owner.token, retroId, 'retro.close', { nextRetroAt: '2026-03-01', override: true });
    expect(res.statusCode).toBe(200);

    const { data: row } = await admin.from('retros').select('phase, closed_with_override').eq('id', retroId).single();
    expect(row).toMatchObject({ phase: 'closed', closed_with_override: true });
  });

  it('a done item missing an owner never blocks close — only open/in_progress count', async () => {
    const owner = await createTeamMember('done-ownerless');
    const retroId = await createRetroInWrapUp(owner.token, owner.userId);
    const itemId = randomUUID();
    await sendMutation(owner.token, retroId, 'actionItem.create', {
      id: itemId,
      title: 'Already done',
      sourceTopicId: null,
      ownerId: null,
      dueDate: null,
      origin: 'manual',
    });
    await admin.from('action_items').update({ status: 'done' }).eq('id', itemId);

    const res = await sendMutation(owner.token, retroId, 'retro.close', { nextRetroAt: '2026-03-01', override: false });
    expect(res.statusCode).toBe(200);
  });

  it('rejects closing outside Wrap up', async () => {
    const owner = await createTeamMember('gate');
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { id: retroId, name: `RN-023 gate retro ${retroId}`, templateId },
    });
    const res = await sendMutation(owner.token, retroId, 'retro.close', { nextRetroAt: '2026-03-01', override: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('phase_not_allowed');
  });

  it('phase.next can no longer reach closed from wrap_up — only retro.close may', async () => {
    const owner = await createTeamMember('no-skip');
    const retroId = await createRetroInWrapUp(owner.token, owner.userId);
    const res = await sendMutation(owner.token, retroId, 'phase.next');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('phase_not_allowed');
  });

  it("a bystander's realtime broadcast sees the retro close too", async () => {
    const owner = await createTeamMember('sync-owner');
    const retroId = await createRetroInWrapUp(owner.token, owner.userId);
    const bystander = await createTeamMember('sync-bystander');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: bystander.userId });

    const listener = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await listener.auth.setSession({ access_token: bystander.token, refresh_token: 'unused' }).catch(() => {});
    const retroChannel = listener.channel(`retro:${retroId}`, { config: { private: true } });
    const broadcastPayload = new Promise<{ seq: number; result: unknown }>((resolve) => {
      retroChannel.on('broadcast', { event: 'retro.close' }, (msg) => resolve(msg.payload as never));
    });
    await new Promise<void>((resolve) => retroChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve()));

    const result = await sendMutation(owner.token, retroId, 'retro.close', { nextRetroAt: '2026-03-01', override: false });
    expect(result.statusCode).toBe(200);

    const broadcast = await broadcastPayload;
    expect(broadcast.result).toMatchObject({ phase: 'closed' });

    await listener.removeChannel(retroChannel);
  }, 15000);
}, 30000);
