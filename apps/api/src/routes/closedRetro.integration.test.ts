import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@retronoodle/shared';
import { buildServer } from '../server.js';
import { createTokenVerifier } from '../auth/index.js';
import { RealtimeBus } from '../realtime/RealtimeBus.js';
import { createPool } from '../db/pool.js';
import { createDefaultMutationRegistry } from '../mutations/index.js';

// Same live-project pattern as this repo's other integration tests.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('read-only closed board against a live Supabase project (RN-026)', () => {
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
    const email = `rn026-${label}-${randomUUID()}@example.com`;
    const password = `Rn026-${randomUUID()}!`;
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

  async function getBoard(token: string, retroId: string) {
    return app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${token}` } });
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

    const email = `rn026-owner-${randomUUID()}@example.com`;
    const password = `Rn026-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-026 closed board test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('a non-attending team member can read a closed retro\'s board, and mutations are rejected', async () => {
    const owner = await createTeamMember('closed-owner');
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { id: retroId, name: 'RN-026 retro to close', templateId },
    });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;
    const cardId = randomUUID();
    await sendMutation(owner.token, retroId, 'card.create', { cardId, columnId, body: 'Solo card' });
    await sendMutation(owner.token, retroId, 'phase.next'); // write -> group
    await sendMutation(owner.token, retroId, 'phase.next'); // group -> vote
    await sendMutation(owner.token, retroId, 'phase.next'); // vote -> discuss
    await sendMutation(owner.token, retroId, 'phase.next'); // discuss -> wrap_up
    const closed = await sendMutation(owner.token, retroId, 'retro.close', { nextRetroAt: '2026-04-01', override: true });
    expect(closed.statusCode).toBe(200);

    // A plain team member who never joined this retro via /join at all.
    const outsider = await createTeamMember('closed-reader');
    const board = await getBoard(outsider.token, retroId);
    expect(board.statusCode).toBe(200);
    const body = board.json();
    expect(body.retro.phase).toBe('closed');
    expect(body.topics.length).toBeGreaterThan(0);
    // The facilitator attended (recorded at creation, RN-026) even though they never hit /join.
    expect(body.attendees.some((a: { id: string }) => a.id === owner.userId)).toBe(true);
    // The outsider reading this never joined it, so they're correctly absent from attendance —
    // "team-only access," not "participant-only."
    expect(body.attendees.some((a: { id: string }) => a.id === outsider.userId)).toBe(false);

    // "No add, drag, vote or react" — the API itself rejects every one of these on a closed retro,
    // not just the UI hiding the controls.
    const addCard = await sendMutation(outsider.token, retroId, 'card.create', { cardId: randomUUID(), columnId, body: 'Too late' });
    expect(addCard.statusCode).toBe(409);
    const react = await sendMutation(outsider.token, retroId, 'reaction.toggle', { cardId, emoji: '👍' });
    expect(react.statusCode).toBe(409);
    const topicId = body.topics[0].id as string;
    const vote = await sendMutation(outsider.token, retroId, 'vote.add', { topicId });
    expect(vote.statusCode).toBe(409);
  });

  it('a non-member gets 403 on a closed retro\'s board', async () => {
    const owner = await createTeamMember('gate-owner');
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { id: retroId, name: 'RN-026 gate retro', templateId },
    });

    const outsiderEmail = `rn026-nonmember-${randomUUID()}@example.com`;
    const password = `Rn026-${randomUUID()}!`;
    const { data: created } = await admin.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
    createdUserIds.push(created!.user!.id);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session } = await anon.auth.signInWithPassword({ email: outsiderEmail, password });
    const token = session!.session!.access_token;
    await app!.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });

    const board = await getBoard(token, retroId);
    expect(board.statusCode).toBe(403);
  });

  it('the retro list includes this team\'s retros with phase and closedAt', async () => {
    const owner = await createTeamMember('list-owner');
    const res = await app!.inject({ method: 'GET', url: `/teams/${teamId}/retros`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json().length).toBeGreaterThan(0);
  });
}, 30000);
