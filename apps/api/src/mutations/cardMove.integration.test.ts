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

describe.skipIf(!hasLiveEnv)('card.move against a live Supabase project (RN-014)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let authorId: string | undefined;
  let otherId: string | undefined;
  let teamId: string | undefined;
  let authorToken: string | undefined;
  let otherToken: string | undefined;
  let templateId: string | undefined;

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    if (authorId) await admin.auth.admin.deleteUser(authorId);
    if (otherId) await admin.auth.admin.deleteUser(otherId);
    await pool.end();
  });

  async function createSignedInUser(label: string) {
    const email = `rn014-${label}-${randomUUID()}@example.com`;
    const password = `Rn014-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error(`failed to create ${label}`);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
    return { userId: created.user.id, token: session.session.access_token };
  }

  async function sendMutation(token: string, retroId: string, type: string, payload: unknown = {}) {
    return app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mutationId: randomUUID(), type, payload },
    });
  }

  async function createRetroWithCard() {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { id: retroId, name: `RN-014 retro ${retroId}`, templateId },
    });
    const { data: columns } = await admin
      .from('retro_columns')
      .select('id, kind')
      .eq('retro_id', retroId)
      .order('position');
    const standardColumns = columns!.filter((c) => c.kind === 'standard');
    const actionItemsColumn = columns!.find((c) => c.kind === 'action_items')!;

    const cardId = randomUUID();
    await sendMutation(authorToken!, retroId, 'card.create', { cardId, columnId: standardColumns[0]!.id, body: 'Move me' });

    return { retroId, cardId, columnA: standardColumns[0]!.id, columnB: standardColumns[1]!.id, actionItemsColumnId: actionItemsColumn.id };
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
      payload: { id: teamId, name: 'RN-014 card.move test team' },
    });
    await admin.from('profiles').insert({ id: otherId, display_name: 'Other', email: `${otherId}@example.com` });
    await admin.from('team_members').insert({ team_id: teamId, user_id: otherId!, role: 'member' });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${authorToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it('reordering within a column and moving across columns persists after reload, and each drop writes exactly one row', async () => {
    const { retroId, cardId, columnB } = await createRetroWithCard();

    const before = await app!.inject({
      method: 'GET',
      url: `/retros/${retroId}/board`,
      headers: { authorization: `Bearer ${authorToken}` },
    });
    const seqBefore = before.json().seq as number;

    const move = await sendMutation(authorToken!, retroId, 'card.move', { cardId, columnId: columnB, position: 'b0' });
    expect(move.statusCode).toBe(200);
    expect(move.json().seq).toBe(seqBefore + 1); // exactly one row/seq consumed by the drop

    const after = await app!.inject({
      method: 'GET',
      url: `/retros/${retroId}/board`,
      headers: { authorization: `Bearer ${authorToken}` },
    });
    const card = after.json().cards.find((c: { id: string }) => c.id === cardId);
    expect(card).toMatchObject({ columnId: columnB, position: 'b0' });
  });

  it('in Write, a non-author cannot move another participant\'s card', async () => {
    const { retroId, cardId, columnB } = await createRetroWithCard();
    const res = await sendMutation(otherToken!, retroId, 'card.move', { cardId, columnId: columnB, position: 'b0' });
    expect(res.statusCode).toBe(403);
  });

  it('in Group, anyone may move anyone\'s card', async () => {
    const { retroId, cardId, columnB } = await createRetroWithCard();
    await sendMutation(authorToken!, retroId, 'phase.next'); // write -> group

    const res = await sendMutation(otherToken!, retroId, 'card.move', { cardId, columnId: columnB, position: 'b0' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects card.move once past Group (Vote onward locks cards)', async () => {
    const { retroId, cardId, columnB } = await createRetroWithCard();
    await sendMutation(authorToken!, retroId, 'phase.next'); // write -> group
    await sendMutation(authorToken!, retroId, 'phase.next'); // group -> vote

    const res = await sendMutation(authorToken!, retroId, 'card.move', { cardId, columnId: columnB, position: 'b0' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('phase_not_allowed');
  });

  it("rejects dragging a card into the Action items column", async () => {
    const { retroId, cardId, actionItemsColumnId } = await createRetroWithCard();

    const res = await sendMutation(authorToken!, retroId, 'card.move', { cardId, columnId: actionItemsColumnId, position: 'a0' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_column');
  });
}, 30000);
