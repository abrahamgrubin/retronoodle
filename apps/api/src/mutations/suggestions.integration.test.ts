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

// Same live-project pattern as this repo's other integration tests. Never calls the real
// Anthropic API (that's covered by groupCards.test.ts's mocked unit tests) — these mutations
// only read/write group_suggestions once a row already exists, simulating what the worker job
// would have inserted.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('suggestion.accept / suggestion.reject against a live Supabase project (RN-017)', () => {
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

  // POST /retros/:id/mutations is rate-limited to 20/s *per user* (routes/mutations.ts) — against
  // this suite's real target database, app.inject() has no network latency to throttle it, so
  // reusing one facilitator token across every test's retro-create + 2 card-creates + phase.next
  // + mutation can trip that limit well before any of it is a burst a real user would send (see
  // topics.integration.test.ts's own fix for the same issue). A fresh team member per test keeps
  // each test's own handful of calls on its own limiter bucket.
  async function createTeamMember(label: string) {
    const email = `rn017-${label}-${randomUUID()}@example.com`;
    const password = `Rn017-${randomUUID()}!`;
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

  // The caller of this becomes the retro's facilitator (whoever creates it) — a fresh one per
  // test, per the rate-limit note above.
  async function createRetroWithSuggestion(facilitatorToken: string) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
      payload: { id: retroId, name: `RN-017 retro ${retroId}`, templateId },
    });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;

    const cardAId = randomUUID();
    const cardBId = randomUUID();
    await sendMutation(facilitatorToken, retroId, 'card.create', { cardId: cardAId, columnId, body: 'Card A' });
    await sendMutation(facilitatorToken, retroId, 'card.create', { cardId: cardBId, columnId, body: 'Card B' });
    await sendMutation(facilitatorToken, retroId, 'phase.next'); // write -> group

    const suggestionId = randomUUID();
    await admin.from('group_suggestions').insert({ id: suggestionId, retro_id: retroId, name: 'AI suggested group', card_ids: [cardAId, cardBId] });

    return { retroId, suggestionId, cardAId, cardBId, columnId };
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

    // A one-off owner just to stand up the team and read its templates.
    const email = `rn017-owner-${randomUUID()}@example.com`;
    const password = `Rn017-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-017 suggestions test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('accepting creates the group for everyone and marks the suggestion accepted', async () => {
    const { token } = await createTeamMember('a');
    const { retroId, suggestionId, cardAId, cardBId, columnId } = await createRetroWithSuggestion(token);

    const res = await sendMutation(token, retroId, 'suggestion.accept', { suggestionId });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({
      topic: { name: 'AI suggested group', columnId },
      cards: expect.arrayContaining([expect.objectContaining({ id: cardAId }), expect.objectContaining({ id: cardBId })]),
    });

    const { data: row } = await admin.from('group_suggestions').select('status').eq('id', suggestionId).maybeSingle();
    expect(row?.status).toBe('accepted');

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${token}` } });
    const cards = board.json().cards as Array<{ id: string; topicId: string | null }>;
    expect(cards.find((c) => c.id === cardAId)?.topicId).toBe(cards.find((c) => c.id === cardBId)?.topicId);
  });

  it('rejects accept from a non-facilitator', async () => {
    const { token: facilitatorToken } = await createTeamMember('b');
    const { token: otherToken } = await createTeamMember('c');
    const { retroId, suggestionId } = await createRetroWithSuggestion(facilitatorToken);
    const res = await sendMutation(otherToken, retroId, 'suggestion.accept', { suggestionId });
    expect(res.statusCode).toBe(403);
  });

  it('rejecting removes it (marks rejected) without touching any cards', async () => {
    const { token } = await createTeamMember('d');
    const { retroId, suggestionId, cardAId } = await createRetroWithSuggestion(token);

    const res = await sendMutation(token, retroId, 'suggestion.reject', { suggestionId });
    expect(res.statusCode).toBe(200);

    const { data: row } = await admin.from('group_suggestions').select('status').eq('id', suggestionId).maybeSingle();
    expect(row?.status).toBe('rejected');

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${token}` } });
    const card = board.json().cards.find((c: { id: string }) => c.id === cardAId);
    expect(card.topicId).toBeNull();
  });

  it('rejects accepting an already-resolved suggestion (e.g. double-click)', async () => {
    const { token } = await createTeamMember('e');
    const { retroId, suggestionId } = await createRetroWithSuggestion(token);
    await sendMutation(token, retroId, 'suggestion.reject', { suggestionId });

    const res = await sendMutation(token, retroId, 'suggestion.accept', { suggestionId });
    expect(res.statusCode).toBe(404);
  });

  it('discards a still-pending suggestion once the retro reaches Vote', async () => {
    const { token } = await createTeamMember('f');
    const { retroId, suggestionId } = await createRetroWithSuggestion(token);
    await sendMutation(token, retroId, 'phase.next'); // group -> vote

    const { data: row } = await admin.from('group_suggestions').select('status').eq('id', suggestionId).maybeSingle();
    expect(row?.status).toBe('rejected');
  });
}, 30000);
