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

// Same live-project pattern as RN-004/RN-008/RN-009/RN-010's integration tests. This is the
// strongest proof short of an actual browser that a non-author's network traffic never carries
// hidden card text (RN-011's Playwright AC, covered separately by e2e/hidden-cards.spec.ts) —
// it inspects the exact same two payloads a real browser would receive: the GET /board response
// body and the Realtime broadcast frame.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('hidden cards against a live Supabase project (RN-011)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let authorId: string | undefined;
  let otherId: string | undefined;
  let teamId: string | undefined;
  let retroId: string | undefined;
  let columnId: string | undefined;
  let authorToken: string | undefined;
  let otherToken: string | undefined;

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    if (authorId) await admin.auth.admin.deleteUser(authorId);
    if (otherId) await admin.auth.admin.deleteUser(otherId);
    await pool.end();
  });

  async function createSignedInUser(label: string) {
    const email = `rn011-${label}-${randomUUID()}@example.com`;
    const password = `Rn011-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error(`failed to create ${label}`);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
    return { userId: created.user.id, token: session.session.access_token };
  }

  beforeAll(async () => {
    const author = await createSignedInUser('author');
    authorId = author.userId;
    authorToken = author.token;

    const other = await createSignedInUser('other');
    otherId = other.userId;
    otherToken = other.token;

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

    const authorHeader = { authorization: `Bearer ${authorToken}` };
    await app.inject({ method: 'GET', url: '/me', headers: authorHeader });

    teamId = randomUUID();
    await app.inject({ method: 'POST', url: '/teams', headers: authorHeader, payload: { id: teamId, name: 'RN-011 hidden cards team' } });
    await admin.from('profiles').insert({ id: otherId, display_name: 'Other', email: `${otherId}@example.com` });
    await admin.from('team_members').insert({ team_id: teamId, user_id: otherId!, role: 'member' });

    const templatesRes = await app.inject({ method: 'GET', url: `/teams/${teamId}/templates`, headers: authorHeader });
    const templateId = templatesRes.json()[0].id as string;

    retroId = randomUUID();
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: authorHeader,
      payload: { id: retroId, name: 'RN-011 hidden cards retro', templateId },
    });
    const { data: column } = await admin.from('retro_columns').select('id').eq('retro_id', retroId).limit(1).single();
    columnId = column!.id;
  }, 30000);

  it("GET /board never includes a hidden card's body for a non-author, but always does for the author", async () => {
    const cardId = randomUUID();
    const create = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'card.create', payload: { cardId, columnId, body: 'Author secret' } },
    });
    expect(create.statusCode).toBe(200);

    const otherBoard = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${otherToken}` } });
    const otherCard = otherBoard.json().cards.find((c: { id: string }) => c.id === cardId);
    expect(otherCard).toEqual({ id: cardId, columnId, authorId, position: otherCard.position, topicId: null, hidden: true });
    expect(JSON.stringify(otherBoard.json())).not.toContain('Author secret');

    const authorBoard = await app!.inject({
      method: 'GET',
      url: `/retros/${retroId}/board`,
      headers: { authorization: `Bearer ${authorToken}` },
    });
    const authorCard = authorBoard.json().cards.find((c: { id: string }) => c.id === cardId);
    expect(authorCard).toMatchObject({ id: cardId, body: 'Author secret', hidden: false });
  });

  it("a card.create broadcast never carries the body on the shared retro channel, but does on the author's private channel", async () => {
    const otherListener = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await otherListener.auth.setSession({ access_token: otherToken!, refresh_token: 'unused' }).catch(() => {});
    const retroChannel = otherListener.channel(`retro:${retroId}`, { config: { private: true } });
    const retroChannelPayload = new Promise<{ seq: number; result: unknown }>((resolve) => {
      retroChannel.on('broadcast', { event: 'card.create' }, (msg) => resolve(msg.payload as never));
    });

    const authorListener = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await authorListener.auth.setSession({ access_token: authorToken!, refresh_token: 'unused' }).catch(() => {});
    const userChannel = authorListener.channel(`user:${authorId}`, { config: { private: true } });
    const userChannelPayload = new Promise<{ seq: number; result: unknown }>((resolve) => {
      userChannel.on('broadcast', { event: 'card.create' }, (msg) => resolve(msg.payload as never));
    });

    await Promise.all([
      new Promise<void>((resolve) => retroChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve())),
      new Promise<void>((resolve) => userChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve())),
    ]);

    const cardId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'card.create', payload: { cardId, columnId, body: 'Broadcast secret' } },
    });

    const [retroEvent, userEvent] = await Promise.all([retroChannelPayload, userChannelPayload]);
    expect(retroEvent.result).toMatchObject({ id: cardId, hidden: true });
    expect(JSON.stringify(retroEvent)).not.toContain('Broadcast secret');
    expect(userEvent.result).toMatchObject({ id: cardId, body: 'Broadcast secret', hidden: false });

    await otherListener.removeChannel(retroChannel);
    await authorListener.removeChannel(userChannel);
  }, 15000);

  it('cards.reveal lets the facilitator reveal, broadcasting every card in full to everyone', async () => {
    const cardId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'card.create', payload: { cardId, columnId, body: 'Reveal me' } },
    });

    const nonFacilitatorAttempt = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { mutationId: randomUUID(), type: 'cards.reveal', payload: {} },
    });
    expect(nonFacilitatorAttempt.statusCode).toBe(403);

    const reveal = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'cards.reveal', payload: {} },
    });
    expect(reveal.statusCode).toBe(200);
    const revealed = reveal.json().result.cards.find((c: { id: string }) => c.id === cardId);
    expect(revealed).toMatchObject({ id: cardId, body: 'Reveal me', hidden: false });

    const otherBoard = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${otherToken}` } });
    const otherCard = otherBoard.json().cards.find((c: { id: string }) => c.id === cardId);
    expect(otherCard).toMatchObject({ id: cardId, body: 'Reveal me', hidden: false });
  });
}, 30000);
