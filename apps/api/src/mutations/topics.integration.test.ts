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

describe.skipIf(!hasLiveEnv)('drag-to-group and topics against a live Supabase project (RN-015)', () => {
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
  // this suite's real target database, `app.inject()` has no network latency to throttle it, so
  // reusing one token across this whole file's ~25 mutation calls can trip that limit well before
  // any of it is actually a burst a real user would send. A fresh signed-in user per test keeps
  // each test's own handful of calls on its own limiter bucket.
  async function createTeamMember(label: string) {
    const email = `rn015-${label}-${randomUUID()}@example.com`;
    const password = `Rn015-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error(`failed to create ${label}`);
    createdUserIds.push(created.user.id);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
    const token = session.session.access_token;
    await app!.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });
    await admin.from('team_members').insert({ team_id: teamId!, user_id: created.user.id, role: 'member' });
    return token;
  }

  async function sendMutation(token: string, retroId: string, type: string, payload: unknown = {}) {
    return app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mutationId: randomUUID(), type, payload },
    });
  }

  async function createRetroWithCards(token: string, count: number) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name: `RN-015 retro ${retroId}`, templateId },
    });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;

    const cardIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const cardId = randomUUID();
      await sendMutation(token, retroId, 'card.create', { cardId, columnId, body: `Card ${i}` });
      cardIds.push(cardId);
    }
    await sendMutation(token, retroId, 'phase.next'); // write -> group
    return { retroId, columnId, cardIds };
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

    // A one-off owner just to stand up the team and read its templates — every test below
    // creates its own member to actually create retros and send mutations as (see above).
    const email = `rn015-owner-${randomUUID()}@example.com`;
    const password = `Rn015-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-015 topics test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('creates a group from two cards, adds a third, and all three persist after reload', async () => {
    const token = await createTeamMember('a');
    const { retroId, cardIds } = await createRetroWithCards(token, 3);
    const topicId = randomUUID();

    const create = await sendMutation(token, retroId, 'topic.createFromCards', { topicId, cardIds: [cardIds[0], cardIds[1]] });
    expect(create.statusCode).toBe(200);
    expect(create.json().result.topic).toMatchObject({ id: topicId, name: 'Card 0' });

    const add = await sendMutation(token, retroId, 'card.addToTopic', { cardId: cardIds[2], topicId });
    expect(add.statusCode).toBe(200);

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${token}` } });
    const cards = board.json().cards as Array<{ id: string; topicId: string | null }>;
    for (const cardId of cardIds) {
      expect(cards.find((c) => c.id === cardId)).toMatchObject({ topicId });
    }
    expect(board.json().topics).toEqual([{ id: topicId, columnId: expect.any(String), name: 'Card 0', voteCount: 0, discussionOrder: null, startedAt: null, endedAt: null, groupSummaryTitle: null, groupSummary: null, discussionQuestions: null, notes: '' }]);
  });

  it('dissolves a group when a drag-out leaves it with one card, and the remaining card is reported as ungrouped', async () => {
    const token = await createTeamMember('b');
    const { retroId, columnId, cardIds } = await createRetroWithCards(token, 2);
    const topicId = randomUUID();
    await sendMutation(token, retroId, 'topic.createFromCards', { topicId, cardIds: [cardIds[0], cardIds[1]] });

    const move = await sendMutation(token, retroId, 'card.move', { cardId: cardIds[0], columnId, position: 'z9' });
    expect(move.statusCode).toBe(200);
    expect(move.json().result).toMatchObject({
      card: { topicId: null },
      dissolvedTopic: { topicId, remainingCard: { id: cardIds[1], topicId: null } },
    });

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${token}` } });
    const cards = board.json().cards as Array<{ id: string; topicId: string | null }>;
    expect(cards.find((c) => c.id === cardIds[1])).toMatchObject({ topicId: null });
    expect(board.json().topics).toEqual([]);
  });

  it('lets anyone rename a group, and the latest rename wins', async () => {
    const token = await createTeamMember('c');
    const { retroId, cardIds } = await createRetroWithCards(token, 2);
    const topicId = randomUUID();
    await sendMutation(token, retroId, 'topic.createFromCards', { topicId, cardIds: [cardIds[0], cardIds[1]] });

    const rename = await sendMutation(token, retroId, 'topic.rename', { topicId, name: 'Renamed group' });
    expect(rename.statusCode).toBe(200);

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${token}` } });
    expect(board.json().topics).toEqual([{ id: topicId, columnId: expect.any(String), name: 'Renamed group', voteCount: 0, discussionOrder: null, startedAt: null, endedAt: null, groupSummaryTitle: null, groupSummary: null, discussionQuestions: null, notes: '' }]);
  });

  it('rejects grouping once past Group (Vote locks it)', async () => {
    const token = await createTeamMember('d');
    const { retroId, cardIds } = await createRetroWithCards(token, 2);
    await sendMutation(token, retroId, 'phase.next'); // group -> vote

    const res = await sendMutation(token, retroId, 'topic.createFromCards', { topicId: randomUUID(), cardIds: [cardIds[0], cardIds[1]] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('phase_not_allowed');
  });

  it('on entering Vote, every card belongs to exactly one topic — grouped cards keep their group, ungrouped ones each get their own', async () => {
    const token = await createTeamMember('e');
    const { retroId, cardIds } = await createRetroWithCards(token, 3);
    const topicId = randomUUID();
    await sendMutation(token, retroId, 'topic.createFromCards', { topicId, cardIds: [cardIds[0], cardIds[1]] });

    await sendMutation(token, retroId, 'phase.next'); // group -> vote

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${token}` } });
    const cards = board.json().cards as Array<{ id: string; topicId: string | null }>;
    for (const card of cards) expect(card.topicId).not.toBeNull();
    expect(cards.find((c) => c.id === cardIds[0])!.topicId).toBe(topicId);
    expect(cards.find((c) => c.id === cardIds[1])!.topicId).toBe(topicId);
    expect(cards.find((c) => c.id === cardIds[2])!.topicId).not.toBe(topicId); // its own solo topic
    expect(board.json().topics).toHaveLength(2); // the pair's group + card 2's solo topic
  });
}, 30000);
