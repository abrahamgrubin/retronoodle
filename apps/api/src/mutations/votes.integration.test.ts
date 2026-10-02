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

describe.skipIf(!hasLiveEnv)('dot voting against a live Supabase project (RN-018)', () => {
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

  // POST /retros/:id/mutations is rate-limited to 20/s *per user* (routes/mutations.ts) — a
  // fresh team member per test (see topics.integration.test.ts's own fix for the same issue)
  // keeps each test's own handful of calls on its own limiter bucket. The one exception is the
  // concurrency test below, which the AC itself requires to come from *one* user — there, a
  // fresh user is still created (so earlier tests' calls can't contribute to its bucket), but
  // the burst itself can legitimately trip the limiter; see that test's own comment.
  async function createTeamMember(label: string) {
    const email = `rn018-${label}-${randomUUID()}@example.com`;
    const password = `Rn018-${randomUUID()}!`;
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

  // The caller becomes the retro's facilitator and sole participant unless `participants` adds
  // more. Advances all the way to Vote with one topic (two cards grouped together) ready to
  // receive dots.
  async function createRetroInVote(facilitatorToken: string, facilitatorUserId: string, voteBudget = 3) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
      payload: { id: retroId, name: `RN-018 retro ${retroId}`, templateId },
    });
    if (voteBudget !== 3) await admin.from('retros').update({ vote_budget: voteBudget }).eq('id', retroId);
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: facilitatorUserId });

    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;

    const cardAId = randomUUID();
    const cardBId = randomUUID();
    await sendMutation(facilitatorToken, retroId, 'card.create', { cardId: cardAId, columnId, body: 'Card A' });
    await sendMutation(facilitatorToken, retroId, 'card.create', { cardId: cardBId, columnId, body: 'Card B' });
    await sendMutation(facilitatorToken, retroId, 'phase.next'); // write -> group

    const topicId = randomUUID();
    await sendMutation(facilitatorToken, retroId, 'topic.createFromCards', { topicId, cardIds: [cardAId, cardBId] });

    await sendMutation(facilitatorToken, retroId, 'phase.next'); // group -> vote

    return { retroId, topicId, columnId };
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

    const email = `rn018-owner-${randomUUID()}@example.com`;
    const password = `Rn018-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-018 voting test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('adds and removes dots, tracking the remaining budget correctly', async () => {
    const { userId, token } = await createTeamMember('a');
    const { retroId, topicId } = await createRetroInVote(token, userId, 3);

    const add1 = await sendMutation(token, retroId, 'vote.add', { topicId });
    expect(add1.statusCode).toBe(200);
    expect(add1.json().result).toMatchObject({ topicId, myCount: 1, remaining: 2 });

    const add2 = await sendMutation(token, retroId, 'vote.add', { topicId });
    expect(add2.json().result).toMatchObject({ myCount: 2, remaining: 1 });

    const remove = await sendMutation(token, retroId, 'vote.remove', { topicId });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().result).toMatchObject({ myCount: 1, remaining: 2 });

    // vote.remove doesn't distinguish "topic doesn't exist" from "you have no votes there" —
    // either way there's nothing to remove, so both are the same 409.
    const removeNonexistentTopic = await sendMutation(token, retroId, 'vote.remove', { topicId: randomUUID() });
    expect(removeNonexistentTopic.statusCode).toBe(409);
    expect(removeNonexistentTopic.json().error).toBe('no_votes_on_topic');

    const { data: rows } = await admin.from('votes').select('id').eq('retro_id', retroId).eq('user_id', userId);
    expect(rows).toHaveLength(1);
  });

  it('rejects once the budget is spent, and rejects outside Vote', async () => {
    const { userId, token } = await createTeamMember('b');
    const { retroId, topicId } = await createRetroInVote(token, userId, 1);

    const first = await sendMutation(token, retroId, 'vote.add', { topicId });
    expect(first.statusCode).toBe(200);
    const second = await sendMutation(token, retroId, 'vote.add', { topicId });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('no_votes_left');

    await sendMutation(token, retroId, 'phase.next'); // vote -> discuss
    const afterDiscuss = await sendMutation(token, retroId, 'vote.add', { topicId });
    expect(afterDiscuss.statusCode).toBe(409);
    expect(afterDiscuss.json().error).toBe('phase_not_allowed');
  });

  // RN-018 AC, verbatim: "Integration test: 50 concurrent vote.add calls from one user never
  // exceed the budget." A real 50-wide burst from one user also trips RN-008's own 20/s-per-user
  // rate limit (routes/mutations.ts) before most of them ever reach the mutation pipeline at
  // all — that's correct, unrelated behavior, not a reason to soften this test. What the AC
  // actually cares about is the race-condition protection itself: however many of the 50 land
  // (200 or 409), the database never ends up with more rows for this user than their budget,
  // and never more than `vote_budget` responses come back 200.
  it('50 concurrent vote.add calls from one user never exceed the budget', async () => {
    const voteBudget = 3;
    const { userId, token } = await createTeamMember('concurrency');
    const { retroId, topicId } = await createRetroInVote(token, userId, voteBudget);

    const responses = await Promise.all(Array.from({ length: 50 }, () => sendMutation(token, retroId, 'vote.add', { topicId })));

    const statusCodes = responses.map((r) => r.statusCode);
    const successes = statusCodes.filter((s) => s === 200);
    expect(successes.length).toBeLessThanOrEqual(voteBudget);
    for (const status of statusCodes) expect([200, 409, 429]).toContain(status);

    const { data: rows } = await admin.from('votes').select('id').eq('retro_id', retroId).eq('user_id', userId);
    expect(rows).toHaveLength(successes.length);
    expect(rows!.length).toBeLessThanOrEqual(voteBudget);
  }, 30000);

  // RN-018 AC, verbatim: "During Vote, no browser receives another person's votes or topic
  // totals (network check)." Inspects the exact payloads a real browser would receive — the
  // Realtime broadcast frame on the shared channel, and a bystander's own GET /board — the same
  // technique hiddenCards.integration.test.ts (RN-011) uses for hidden card text.
  it("a bystander's realtime broadcast and board snapshot never contain another voter's topic or count", async () => {
    const voter = await createTeamMember('voter');
    const { retroId, topicId } = await createRetroInVote(voter.token, voter.userId, 3);
    const bystander = await createTeamMember('bystander');
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: bystander.userId });

    const listener = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await listener.auth.setSession({ access_token: bystander.token, refresh_token: 'unused' }).catch(() => {});
    const retroChannel = listener.channel(`retro:${retroId}`, { config: { private: true } });
    const broadcastPayload = new Promise<{ seq: number; result: unknown }>((resolve) => {
      retroChannel.on('broadcast', { event: 'vote.add' }, (msg) => resolve(msg.payload as never));
    });
    await new Promise<void>((resolve) => retroChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve()));

    const add = await sendMutation(voter.token, retroId, 'vote.add', { topicId });
    expect(add.statusCode).toBe(200);

    const broadcast = await broadcastPayload;
    expect(broadcast.result).toEqual({ done: 0, total: 2 });
    expect(JSON.stringify(broadcast)).not.toContain(topicId);

    const bystanderBoard = await app!.inject({
      method: 'GET',
      url: `/retros/${retroId}/board`,
      headers: { authorization: `Bearer ${bystander.token}` },
    });
    const body = bystanderBoard.json();
    expect(body.myVotes).toEqual([]); // the bystander's own votes — correctly empty
    expect(body.votingProgress).toEqual({ done: 0, total: 2 });
    expect(JSON.stringify(body.topics)).not.toContain('"voteCount":1'); // not yet revealed

    await listener.removeChannel(retroChannel);
  }, 15000);

  it('on entering Discuss, every topic gets its real vote_count, ranked by votes desc then creation time, and only the top one is started', async () => {
    const { userId, token } = await createTeamMember('rank');
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name: `RN-018 ranking retro ${retroId}`, templateId },
    });
    await admin.from('retro_participants').upsert({ retro_id: retroId, user_id: userId });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    const columnId = columns!.find((c) => c.kind === 'standard')!.id;

    const cardLowId = randomUUID();
    const cardHighId = randomUUID();
    await sendMutation(token, retroId, 'card.create', { cardId: cardLowId, columnId, body: 'Fewer votes' });
    await sendMutation(token, retroId, 'card.create', { cardId: cardHighId, columnId, body: 'More votes' });
    await sendMutation(token, retroId, 'phase.next'); // write -> group
    await sendMutation(token, retroId, 'phase.next'); // group -> vote: both cards become solo topics

    const { data: topics } = await admin.from('topics').select('id, name').eq('retro_id', retroId);
    const lowTopic = topics!.find((t) => t.name === 'Fewer votes')!;
    const highTopic = topics!.find((t) => t.name === 'More votes')!;

    await sendMutation(token, retroId, 'vote.add', { topicId: lowTopic.id });
    await sendMutation(token, retroId, 'vote.add', { topicId: highTopic.id });
    await sendMutation(token, retroId, 'vote.add', { topicId: highTopic.id });

    await sendMutation(token, retroId, 'phase.next'); // vote -> discuss

    const { data: revealed } = await admin
      .from('topics')
      .select('id, vote_count, discussion_order, started_at')
      .eq('retro_id', retroId)
      .order('discussion_order', { ascending: true });

    const revealedHigh = revealed!.find((t) => t.id === highTopic.id)!;
    const revealedLow = revealed!.find((t) => t.id === lowTopic.id)!;
    expect(revealedHigh.vote_count).toBe(2);
    expect(revealedLow.vote_count).toBe(1);
    expect(revealed![0]!.id).toBe(highTopic.id); // ranked first
    expect(revealedHigh.started_at).not.toBeNull(); // "first topic becomes current"
    expect(revealedLow.started_at).toBeNull();
  });
}, 30000);
