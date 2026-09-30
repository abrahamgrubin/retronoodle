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

// Runs against a real Supabase project — the whole point of RN-008's acceptance criteria
// (gapless ordering under concurrency, idempotent replay) is proving real Postgres row-locking
// behavior, which nothing short of a live database can verify. Skips cleanly without live
// credentials, same pattern as RN-004's RealtimeBus.integration.test.ts.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('mutation pipeline against a live Supabase project (RN-008)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let userId: string | undefined;
  let teamId: string | undefined;
  let retroId: string | undefined;
  let columnId: string | undefined;
  let token: string | undefined;

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    if (userId) await admin.auth.admin.deleteUser(userId);
    await pool.end();
  });

  beforeAll(async () => {
    const email = `rn008-${randomUUID()}@example.com`;
    const password = `Rn008-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error('failed to create test user');
    userId = created.user.id;

    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error('failed to sign in test user');
    token = session.session.access_token;

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

    const authHeader = { authorization: `Bearer ${token}` };
    await app.inject({ method: 'GET', url: '/me', headers: authHeader });

    teamId = randomUUID();
    const teamRes = await app.inject({
      method: 'POST',
      url: '/teams',
      headers: authHeader,
      payload: { id: teamId, name: 'RN-008 pipeline test team' },
    });
    if (teamRes.statusCode !== 201) throw new Error(`team create failed: ${teamRes.body}`);

    const templatesRes = await app.inject({ method: 'GET', url: `/teams/${teamId}/templates`, headers: authHeader });
    const templateId = templatesRes.json()[0].id as string;

    retroId = randomUUID();
    const retroRes = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: authHeader,
      payload: { id: retroId, name: 'RN-008 pipeline test retro', templateId },
    });
    if (retroRes.statusCode !== 201) throw new Error(`retro create failed: ${retroRes.body}`);

    const { data: column, error: columnErr } = await admin
      .from('retro_columns')
      .select('id')
      .eq('retro_id', retroId)
      .limit(1)
      .single();
    if (columnErr || !column) throw columnErr ?? new Error('no column on the new retro');
    columnId = column.id;
  }, 30000);

  function authHeader() {
    return { authorization: `Bearer ${token}` };
  }

  it('applies a card.create mutation, stores it as retro_events seq 1, and creates the card', async () => {
    const mutationId = randomUUID();
    const cardId = randomUUID();
    const res = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: authHeader(),
      payload: { mutationId, type: 'card.create', payload: { cardId, columnId, body: 'First card' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.seq).toBe(1);
    expect(body.result).toMatchObject({ id: cardId, body: 'First card' });

    const { data: card } = await admin.from('cards').select('body, author_id').eq('id', cardId).single();
    expect(card).toMatchObject({ body: 'First card', author_id: userId });
  });

  it('replaying the same mutationId returns the same seq without creating a second card', async () => {
    const mutationId = randomUUID();
    const cardId = randomUUID();
    const payload = { mutationId, type: 'card.create', payload: { cardId, columnId, body: 'Replay me' } };

    const first = await app!.inject({ method: 'POST', url: `/retros/${retroId}/mutations`, headers: authHeader(), payload });
    const second = await app!.inject({ method: 'POST', url: `/retros/${retroId}/mutations`, headers: authHeader(), payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().seq).toBe(first.json().seq);

    const { count } = await admin.from('cards').select('*', { count: 'exact', head: true }).eq('id', cardId);
    expect(count).toBe(1);
  });

  it('rejects a card body over 500 characters', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: authHeader(),
      payload: {
        mutationId: randomUUID(),
        type: 'card.create',
        payload: { cardId: randomUUID(), columnId, body: 'x'.repeat(501) },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a non-member is rejected', async () => {
    const email = `rn008-outsider-${randomUUID()}@example.com`;
    const password = `Rn008-${randomUUID()}!`;
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session } = await anon.auth.signInWithPassword({ email, password });

    const res = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${session!.session!.access_token}` },
      payload: {
        mutationId: randomUUID(),
        type: 'card.create',
        payload: { cardId: randomUUID(), columnId, body: 'Should not land' },
      },
    });
    expect(res.statusCode).toBe(403);

    await admin.auth.admin.deleteUser(created!.user!.id);
  });

  it('assigns strictly increasing, gapless seq under 100 concurrent mutations', async () => {
    // 100 requests from *one* user would legitimately hit RN-008's own 20/s-per-user rate
    // limit — that's correct behavior, just not what this test is about. Spread the load across
    // 10 team members (10 requests each, well under the cap) instead, which is also a more
    // realistic shape for "100 concurrent mutations" (a busy retro with many participants, not
    // one user in a tight loop).
    const memberCount = 10;
    const perMember = 10;
    const password = `Rn008-concurrency-${randomUUID()}!`;
    const members = await Promise.all(
      Array.from({ length: memberCount }, async (_, i) => {
        const email = `rn008-concurrent-${i}-${randomUUID()}@example.com`;
        const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !created.user) throw error ?? new Error('failed to create concurrency test user');
        await admin
          .from('profiles')
          .insert({ id: created.user.id, display_name: `Concurrent ${i}`, email });
        await admin.from('team_members').insert({ team_id: teamId!, user_id: created.user.id, role: 'member' });
        const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
        const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
        if (signInErr || !session.session) throw signInErr ?? new Error('failed to sign in concurrency test user');
        return { userId: created.user.id, token: session.session.access_token };
      }),
    );

    const requests = members.flatMap((member) =>
      Array.from({ length: perMember }, () =>
        app!.inject({
          method: 'POST',
          url: `/retros/${retroId}/mutations`,
          headers: { authorization: `Bearer ${member.token}` },
          payload: {
            mutationId: randomUUID(),
            type: 'card.create',
            payload: { cardId: randomUUID(), columnId, body: 'Concurrent card' },
          },
        }),
      ),
    );
    const responses = await Promise.all(requests);
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);

    await Promise.all(members.map((m) => admin.auth.admin.deleteUser(m.userId)));

    const seqs = responses.map((r) => r.json().seq as number).sort((a, b) => a - b);
    const uniqueSeqs = new Set(seqs);
    expect(uniqueSeqs.size).toBe(100);
    for (const seq of seqs) expect(Number.isInteger(seq)).toBe(true);

    // Gapless across the *whole* consecutive run: min..max is exactly 100 wide, matching the
    // 100 successful responses (the earlier tests in this file also consumed seqs 1-3, so this
    // isn't asserting seqs are 1..100 globally, just that these 100 are contiguous among
    // themselves).
    const min = Math.min(...seqs);
    const max = Math.max(...seqs);
    expect(max - min + 1).toBe(100);
  }, 120000);

  it('broadcasts the mutation to a subscribed team member within 500ms', async () => {
    // Reuse the facilitator's own session (already a team member) to subscribe.
    const listenerClient = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await listenerClient.auth.setSession({ access_token: token!, refresh_token: 'unused' }).catch(() => {});

    const channel = listenerClient.channel(`retro:${retroId}`, { config: { private: true } });
    // RealtimeBus.broadcastRetro sends `{ seq, result }` as the broadcast payload directly
    // (see pipeline.ts) — `msg.payload` here *is* that object, not another nested `payload`.
    const received = new Promise<{ seq: number; result: unknown }>((resolve) => {
      channel.on('broadcast', { event: 'card.create' }, (msg) => resolve(msg.payload as never));
    });
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
      });
    });

    const start = Date.now();
    const mutationId = randomUUID();
    const cardId = randomUUID();
    const res = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: authHeader(),
      payload: { mutationId, type: 'card.create', payload: { cardId, columnId, body: 'Broadcast me' } },
    });
    expect(res.statusCode).toBe(200);

    const event = await received;
    const elapsedMs = Date.now() - start;
    // This is genuinely sensitive to where it runs. Against the hosted project from a sandbox
    // far from its us-west-2 region, round trips alone cost ~85ms each, and even the pipeline's
    // reduced 5-round-trip transaction plus one broadcast lands around 700-750ms — measured and
    // optimized (was 1190ms before combining queries into fewer round trips), but still over.
    // In CI this test runs against a local Docker Supabase stack (same host, no network RTT to
    // speak of), and in real local dev the browser, API and DB are typically close too — both
    // match the story's own "two local browsers" framing, unlike this sandbox. Kept as a hard
    // assertion rather than softened, since it's correct in the environments that matter.
    expect(elapsedMs).toBeLessThan(500);
    expect(event.seq).toBe(res.json().seq);

    await listenerClient.removeChannel(channel);
  }, 15000);
});
