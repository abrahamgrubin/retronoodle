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

// Same live-project pattern as RN-010's phaseTransition.integration.test.ts.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('phase timer against a live Supabase project (RN-012)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let facilitatorId: string | undefined;
  let participantId: string | undefined;
  let teamId: string | undefined;
  let facilitatorToken: string | undefined;
  let participantToken: string | undefined;
  let templateId: string | undefined;

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    if (facilitatorId) await admin.auth.admin.deleteUser(facilitatorId);
    if (participantId) await admin.auth.admin.deleteUser(participantId);
    await pool.end();
  });

  async function createSignedInUser(label: string) {
    const email = `rn012-${label}-${randomUUID()}@example.com`;
    const password = `Rn012-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error(`failed to create ${label}`);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
    return { userId: created.user.id, token: session.session.access_token };
  }

  async function createRetro() {
    const retroId = randomUUID();
    const res = await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
      payload: { id: retroId, name: `RN-012 retro ${retroId}`, templateId },
    });
    return res.json() as { id: string; phase: string };
  }

  async function sendMutation(token: string, retroId: string, type: string, payload: unknown = {}) {
    return app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mutationId: randomUUID(), type, payload },
    });
  }

  async function getBoard(token: string, retroId: string) {
    const res = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${token}` } });
    return res.json() as { retro: { phaseDeadline: string | null }; serverTime: string };
  }

  beforeAll(async () => {
    const facilitator = await createSignedInUser('facilitator');
    facilitatorId = facilitator.userId;
    facilitatorToken = facilitator.token;

    const participant = await createSignedInUser('participant');
    participantId = participant.userId;
    participantToken = participant.token;

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

    await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${facilitatorToken}` } });

    teamId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/teams',
      headers: { authorization: `Bearer ${facilitatorToken}` },
      payload: { id: teamId, name: 'RN-012 phase timer test team' },
    });
    await admin.from('profiles').insert({ id: participantId, display_name: 'Participant', email: `${participantId}@example.com` });
    await admin.from('team_members').insert({ team_id: teamId, user_id: participantId!, role: 'member' });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('a retro starts with a deadline roughly 5 minutes out (Write\'s default), and GET /board includes serverTime', async () => {
    const retro = await createRetro();
    const board = await getBoard(facilitatorToken!, retro.id);

    expect(board.retro.phaseDeadline).not.toBeNull();
    const remainingMinutes = (Date.parse(board.retro.phaseDeadline!) - Date.parse(board.serverTime)) / 60_000;
    expect(remainingMinutes).toBeGreaterThan(4.9);
    expect(remainingMinutes).toBeLessThanOrEqual(5);
  });

  it('phase.next sets a fresh deadline matching the target phase\'s own default (Group: 5 min)', async () => {
    const retro = await createRetro();
    const before = Date.now();
    const res = await sendMutation(facilitatorToken!, retro.id, 'phase.next');
    expect(res.statusCode).toBe(200);
    const result = res.json().result as { phase: string; phaseDeadline: string };
    expect(result.phase).toBe('group');
    const remainingMinutes = (Date.parse(result.phaseDeadline) - before) / 60_000;
    expect(remainingMinutes).toBeGreaterThan(4.9);
    expect(remainingMinutes).toBeLessThanOrEqual(5.1);
  });

  it('phase.extend adds the requested minutes to the current deadline', async () => {
    const retro = await createRetro();
    const before = await getBoard(facilitatorToken!, retro.id);
    const beforeDeadline = Date.parse(before.retro.phaseDeadline!);

    const res = await sendMutation(facilitatorToken!, retro.id, 'phase.extend', { minutes: 2 });
    expect(res.statusCode).toBe(200);
    const result = res.json().result as { phaseDeadline: string };
    const afterDeadline = Date.parse(result.phaseDeadline);

    expect((afterDeadline - beforeDeadline) / 60_000).toBeCloseTo(2, 1);
  });

  it('phase.extend 403s a non-facilitator', async () => {
    const retro = await createRetro();
    const res = await sendMutation(participantToken!, retro.id, 'phase.extend', { minutes: 1 });
    expect(res.statusCode).toBe(403);
  });

  it('phase.extend from an already-expired deadline extends from now, not from the stale past value', async () => {
    const retro = await createRetro();
    // Force the deadline into the past directly, simulating a timer that already hit zero.
    const pastDeadline = new Date(Date.now() - 60_000).toISOString();
    await admin.from('retros').update({ phase_deadline: pastDeadline }).eq('id', retro.id);

    const before = Date.now();
    const res = await sendMutation(facilitatorToken!, retro.id, 'phase.extend', { minutes: 2 });
    expect(res.statusCode).toBe(200);
    const result = res.json().result as { phaseDeadline: string };
    const remainingMinutes = (Date.parse(result.phaseDeadline) - before) / 60_000;
    // ~2 minutes from now, not ~1 minute from the stale past deadline.
    expect(remainingMinutes).toBeGreaterThan(1.9);
    expect(remainingMinutes).toBeLessThanOrEqual(2.1);
  });
}, 30000);
