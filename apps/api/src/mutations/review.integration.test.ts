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

describe.skipIf(!hasLiveEnv)('Review phase and carry-over against a live Supabase project (RN-025)', () => {
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
    const email = `rn025-${label}-${randomUUID()}@example.com`;
    const password = `Rn025-${randomUUID()}!`;
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

  async function createRetro(token: string, name: string) {
    const retroId = randomUUID();
    await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${token}` },
      payload: { id: retroId, name, templateId },
    });
    return retroId;
  }

  async function seedCarriedItem(sourceRetroId: string, status: 'open' | 'in_progress' = 'open') {
    const itemId = randomUUID();
    await admin.from('action_items').insert({
      id: itemId,
      team_id: teamId!,
      source_retro_id: sourceRetroId,
      title: `Carried item ${itemId}`,
      status,
      origin: 'manual',
    });
    return itemId;
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

    const email = `rn025-owner-${randomUUID()}@example.com`;
    const password = `Rn025-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-025 review test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    templateId = templatesRes.json()[0].id as string;
  }, 30000);

  it("a second retro opens in Review showing the first retro's open items", async () => {
    const owner = await createTeamMember('opens-in-review');
    const firstRetroId = await createRetro(owner.token, 'RN-025 first retro A');
    const itemId = await seedCarriedItem(firstRetroId);

    const secondRetroId = await createRetro(owner.token, 'RN-025 second retro A');
    const board = await getBoard(owner.token, secondRetroId);
    expect(board.statusCode).toBe(200);
    const body = board.json();
    expect(body.retro.phase).toBe('review');
    expect(body.actionItems.some((i: { id: string }) => i.id === itemId)).toBe(true);
  });

  it('marking an item done in Review sets completed_at and it never shows in a later Review', async () => {
    const owner = await createTeamMember('mark-done');
    const firstRetroId = await createRetro(owner.token, 'RN-025 first retro B');
    const itemId = await seedCarriedItem(firstRetroId);

    const secondRetroId = await createRetro(owner.token, 'RN-025 second retro B');
    const { data: secondPhase } = await admin.from('retros').select('phase').eq('id', secondRetroId).single();
    expect(secondPhase!.phase).toBe('review');

    const reviewRes = await sendMutation(owner.token, secondRetroId, 'actionItem.review', { actionItemId: itemId, outcome: 'done' });
    expect(reviewRes.statusCode).toBe(200);
    expect(reviewRes.json().result).toMatchObject({ outcome: 'done', actionItem: { status: 'done' } });

    const { data: row } = await admin.from('action_items').select('status, completed_at').eq('id', itemId).single();
    expect(row!.status).toBe('done');
    expect(row!.completed_at).not.toBeNull();

    // A third retro: the item is 'done' now, so it's no longer a carried item at all.
    const thirdItemId = await seedCarriedItem(firstRetroId); // keep the team "has carried items" true independently
    const thirdRetroId = await createRetro(owner.token, 'RN-025 third retro B');
    const thirdBoard = await getBoard(owner.token, thirdRetroId);
    expect(thirdBoard.json().actionItems.some((i: { id: string }) => i.id === itemId)).toBe(false);
    expect(thirdBoard.json().actionItems.some((i: { id: string }) => i.id === thirdItemId)).toBe(true);
  });

  it('unmarked items get a carried review row on review -> write, and appear again next retro', async () => {
    const owner = await createTeamMember('carried');
    const firstRetroId = await createRetro(owner.token, 'RN-025 first retro C');
    const itemId = await seedCarriedItem(firstRetroId);

    const secondRetroId = await createRetro(owner.token, 'RN-025 second retro C');
    const { data: secondPhase } = await admin.from('retros').select('phase').eq('id', secondRetroId).single();
    expect(secondPhase!.phase).toBe('review');

    // Never touched — advancing past Review should carry it automatically.
    const next = await sendMutation(owner.token, secondRetroId, 'phase.next');
    expect(next.statusCode).toBe(200);
    expect(next.json().result).toMatchObject({ phase: 'write' });

    const { data: reviewRow } = await admin
      .from('action_item_reviews')
      .select('outcome, actor_id')
      .eq('action_item_id', itemId)
      .eq('retro_id', secondRetroId)
      .single();
    expect(reviewRow).toMatchObject({ outcome: 'carried', actor_id: null });

    // After Review, this retro's own Action items column shows only its own new items — not the
    // carried one anymore (it still exists team-wide, just not scoped to this retro).
    const boardAfter = await getBoard(owner.token, secondRetroId);
    expect(boardAfter.json().actionItems.some((i: { id: string }) => i.id === itemId)).toBe(false);

    // A third retro: the item is still open, so it carries forward again.
    const thirdRetroId = await createRetro(owner.token, 'RN-025 third retro C');
    const { data: thirdPhase } = await admin.from('retros').select('phase').eq('id', thirdRetroId).single();
    expect(thirdPhase!.phase).toBe('review');
    const thirdBoard = await getBoard(owner.token, thirdRetroId);
    expect(thirdBoard.json().actionItems.some((i: { id: string }) => i.id === itemId)).toBe(true);
  });

  it('"Keep open" writes carried immediately and is not overwritten by the review -> write sweep', async () => {
    const owner = await createTeamMember('keep-open');
    const firstRetroId = await createRetro(owner.token, 'RN-025 first retro D');
    const itemId = await seedCarriedItem(firstRetroId);
    const secondRetroId = await createRetro(owner.token, 'RN-025 second retro D');

    const keepOpen = await sendMutation(owner.token, secondRetroId, 'actionItem.review', { actionItemId: itemId, outcome: 'carried' });
    expect(keepOpen.statusCode).toBe(200);

    await sendMutation(owner.token, secondRetroId, 'phase.next'); // review -> write

    const { data: rows } = await admin
      .from('action_item_reviews')
      .select('id, actor_id')
      .eq('action_item_id', itemId)
      .eq('retro_id', secondRetroId);
    expect(rows).toHaveLength(1); // not duplicated by the sweep
    expect(rows![0]!.actor_id).toBe(owner.userId); // the explicit click, not the sweep's null actor
  });

  it('rejects reviewing an item created in this same retro', async () => {
    const owner = await createTeamMember('not-reviewable');
    const firstRetroId = await createRetro(owner.token, 'RN-025 first retro E');
    await seedCarriedItem(firstRetroId); // keeps the next retro starting in Review
    const secondRetroId = await createRetro(owner.token, 'RN-025 second retro E');

    const createRes = await sendMutation(owner.token, secondRetroId, 'actionItem.create', {
      id: randomUUID(),
      title: 'Brand new in Review',
      sourceTopicId: null,
      ownerId: null,
      dueDate: null,
      origin: 'manual',
    });
    expect(createRes.statusCode).toBe(200);
    const newItemId = createRes.json().result.actionItem.id as string;

    const reviewRes = await sendMutation(owner.token, secondRetroId, 'actionItem.review', { actionItemId: newItemId, outcome: 'done' });
    expect(reviewRes.statusCode).toBe(400);
    expect(reviewRes.json().error).toBe('not_reviewable');
  });
}, 30000);
