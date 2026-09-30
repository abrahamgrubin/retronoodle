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

// Same live-project pattern as RN-004/RN-008's integration tests — skips cleanly without live
// credentials.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('board + card edit/delete against a live Supabase project (RN-009)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let authorId: string | undefined;
  let outsiderId: string | undefined;
  let teamId: string | undefined;
  let retroId: string | undefined;
  let columnId: string | undefined;
  let authorToken: string | undefined;
  let outsiderToken: string | undefined;

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    if (authorId) await admin.auth.admin.deleteUser(authorId);
    if (outsiderId) await admin.auth.admin.deleteUser(outsiderId);
    await pool.end();
  });

  async function createSignedInUser(label: string) {
    const email = `rn009-${label}-${randomUUID()}@example.com`;
    const password = `Rn009-${randomUUID()}!`;
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

    const outsider = await createSignedInUser('outsider');
    outsiderId = outsider.userId;
    outsiderToken = outsider.token;

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
    await app.inject({
      method: 'POST',
      url: '/teams',
      headers: authorHeader,
      payload: { id: teamId, name: 'RN-009 board test team' },
    });

    // The outsider joins a DIFFERENT team (so they're a real, distinct authenticated user, but
    // not a member of this retro's team) — using the admin client directly for speed.
    await admin.from('profiles').insert({ id: outsiderId, display_name: 'Outsider', email: `${outsiderId}@example.com` });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: authorHeader,
    });
    const templateId = templatesRes.json()[0].id as string;

    retroId = randomUUID();
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: authorHeader,
      payload: { id: retroId, name: 'RN-009 board test retro', templateId },
    });

    const { data: column } = await admin.from('retro_columns').select('id').eq('retro_id', retroId).limit(1).single();
    columnId = column!.id;
  }, 30000);

  it('GET /retros/:id/board returns the columns and cards created so far', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: `/retros/${retroId}/board`,
      headers: { authorization: `Bearer ${authorToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retro.id).toBe(retroId);
    expect(body.columns.length).toBeGreaterThan(0);
    expect(Array.isArray(body.cards)).toBe(true);
  });

  it('a non-member is rejected from reading the board', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: `/retros/${retroId}/board`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('the author can create, then edit, their own card; it shows up correctly on the board', async () => {
    const cardId = randomUUID();
    const createRes = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: {
        mutationId: randomUUID(),
        type: 'card.create',
        payload: { cardId, columnId, body: 'Original body' },
      },
    });
    expect(createRes.statusCode).toBe(200);

    const editRes = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'card.edit', payload: { cardId, body: 'Edited body' } },
    });
    expect(editRes.statusCode).toBe(200);
    expect(editRes.json().result).toMatchObject({ id: cardId, body: 'Edited body' });

    const boardRes = await app!.inject({
      method: 'GET',
      url: `/retros/${retroId}/board`,
      headers: { authorization: `Bearer ${authorToken}` },
    });
    const card = boardRes.json().cards.find((c: { id: string }) => c.id === cardId);
    expect(card).toMatchObject({ body: 'Edited body', authorId });
  });

  it('a non-author cannot edit or delete the card; the API 403s and the UI would never offer it', async () => {
    const cardId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'card.create', payload: { cardId, columnId, body: 'Mine' } },
    });

    // The outsider isn't even a team member, so this should 403 at the retro.mutate check —
    // add them to the team first to isolate the card-ownership check specifically.
    await admin.from('team_members').insert({ team_id: teamId!, user_id: outsiderId!, role: 'member' });

    const editRes = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: { mutationId: randomUUID(), type: 'card.edit', payload: { cardId, body: 'Hijacked' } },
    });
    expect(editRes.statusCode).toBe(403);

    const deleteRes = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: { mutationId: randomUUID(), type: 'card.delete', payload: { cardId } },
    });
    expect(deleteRes.statusCode).toBe(403);

    const { data: stillThere } = await admin.from('cards').select('body').eq('id', cardId).single();
    expect(stillThere?.body).toBe('Mine');
  });

  it('the author can delete their own card, and it disappears from the board', async () => {
    const cardId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'card.create', payload: { cardId, columnId, body: 'Temporary' } },
    });

    const deleteRes = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'card.delete', payload: { cardId } },
    });
    expect(deleteRes.statusCode).toBe(200);

    const boardRes = await app!.inject({
      method: 'GET',
      url: `/retros/${retroId}/board`,
      headers: { authorization: `Bearer ${authorToken}` },
    });
    expect(boardRes.json().cards.some((c: { id: string }) => c.id === cardId)).toBe(false);
  });

  it('rejects an empty or over-500-character card body', async () => {
    const empty = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { mutationId: randomUUID(), type: 'card.create', payload: { cardId: randomUUID(), columnId, body: '' } },
    });
    expect(empty.statusCode).toBe(400);

    const tooLong = await app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: {
        mutationId: randomUUID(),
        type: 'card.create',
        payload: { cardId: randomUUID(), columnId, body: 'x'.repeat(501) },
      },
    });
    expect(tooLong.statusCode).toBe(400);
  });
});
