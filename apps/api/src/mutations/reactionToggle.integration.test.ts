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

describe.skipIf(!hasLiveEnv)('reaction.toggle against a live Supabase project (RN-016)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let authorId: string | undefined;
  let otherId: string | undefined;
  let teamId: string | undefined;
  let authorToken: string | undefined;
  let otherToken: string | undefined;
  let templateId: string | undefined;
  let retroId: string | undefined;
  let columnId: string | undefined;
  let cardId: string | undefined;

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    if (authorId) await admin.auth.admin.deleteUser(authorId);
    if (otherId) await admin.auth.admin.deleteUser(otherId);
    await pool.end();
  });

  async function createSignedInUser(label: string) {
    const email = `rn016-${label}-${randomUUID()}@example.com`;
    const password = `Rn016-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error(`failed to create ${label}`);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
    return { userId: created.user.id, token: session.session.access_token };
  }

  async function sendMutation(token: string, retro: string, type: string, payload: unknown = {}) {
    return app!.inject({
      method: 'POST',
      url: `/retros/${retro}/mutations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mutationId: randomUUID(), type, payload },
    });
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

    await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${authorToken}` } });
    teamId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/teams',
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { id: teamId, name: 'RN-016 reactions test team' },
    });
    await admin.from('profiles').insert({ id: otherId, display_name: 'Other', email: `${otherId}@example.com` });
    await admin.from('team_members').insert({ team_id: teamId, user_id: otherId!, role: 'member' });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${authorToken}` },
    });
    templateId = templatesRes.json()[0].id as string;

    retroId = randomUUID();
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { id: retroId, name: `RN-016 retro ${retroId}`, templateId },
    });
    const { data: columns } = await admin.from('retro_columns').select('id, kind').eq('retro_id', retroId).order('position');
    columnId = columns!.find((c) => c.kind === 'standard')!.id;
    cardId = randomUUID();
    await sendMutation(authorToken, retroId, 'card.create', { cardId, columnId, body: 'React to me' });
  }, 30000);

  it('rejects reacting on a hidden card in Write, then allows it once revealed — one person adds, another joins the same emoji', async () => {
    const beforeReveal = await sendMutation(otherToken!, retroId!, 'reaction.toggle', { cardId, emoji: '👍' });
    expect(beforeReveal.statusCode).toBe(409);
    expect(beforeReveal.json().error).toBe('phase_not_allowed');

    await sendMutation(authorToken!, retroId!, 'cards.reveal');

    const authorReacts = await sendMutation(authorToken!, retroId!, 'reaction.toggle', { cardId, emoji: '👍' });
    expect(authorReacts.statusCode).toBe(200);
    expect(authorReacts.json().result).toEqual({ cardId, userId: authorId, emoji: '👍', added: true });

    const otherReacts = await sendMutation(otherToken!, retroId!, 'reaction.toggle', { cardId, emoji: '👍' });
    expect(otherReacts.statusCode).toBe(200);
    expect(otherReacts.json().result).toEqual({ cardId, userId: otherId, emoji: '👍', added: true });

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${authorToken}` } });
    const card = board.json().cards.find((c: { id: string }) => c.id === cardId);
    expect(card.reactions).toEqual([{ emoji: '👍', userIds: expect.arrayContaining([authorId, otherId]) }]);
    expect(card.reactions[0].userIds).toHaveLength(2);
  });

  it('a second click removes the same user\'s reaction — one reaction per emoji per person', async () => {
    const remove = await sendMutation(authorToken!, retroId!, 'reaction.toggle', { cardId, emoji: '👍' });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().result).toMatchObject({ added: false });

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${authorToken}` } });
    const card = board.json().cards.find((c: { id: string }) => c.id === cardId);
    expect(card.reactions).toEqual([{ emoji: '👍', userIds: [otherId] }]);
  });

  it('rejects once the retro reaches Vote, even though prior reactions stay stored', async () => {
    await sendMutation(authorToken!, retroId!, 'phase.next'); // write -> group
    await sendMutation(authorToken!, retroId!, 'phase.next'); // group -> vote

    const res = await sendMutation(authorToken!, retroId!, 'reaction.toggle', { cardId, emoji: '🔥' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('phase_not_allowed');

    const board = await app!.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: { authorization: `Bearer ${authorToken}` } });
    const card = board.json().cards.find((c: { id: string }) => c.id === cardId);
    expect(card.reactions).toEqual([{ emoji: '👍', userIds: [otherId] }]);
  });
}, 30000);
