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

// Same live-project pattern as RN-004/RN-008/RN-009's integration tests.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('phase transitions and initial phase against a live Supabase project (RN-010)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let facilitatorId: string | undefined;
  let participantId: string | undefined;
  let teamId: string | undefined;
  let facilitatorToken: string | undefined;
  let participantToken: string | undefined;

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    if (facilitatorId) await admin.auth.admin.deleteUser(facilitatorId);
    if (participantId) await admin.auth.admin.deleteUser(participantId);
    await pool.end();
  });

  async function createSignedInUser(label: string) {
    const email = `rn010-${label}-${randomUUID()}@example.com`;
    const password = `Rn010-${randomUUID()}!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw error ?? new Error(`failed to create ${label}`);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
    return { userId: created.user.id, token: session.session.access_token };
  }

  async function createRetro(templateId: string) {
    const retroId = randomUUID();
    const res = await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
      payload: { id: retroId, name: `RN-010 retro ${retroId}`, templateId },
    });
    return { retroId, phase: res.json().phase as string };
  }

  async function sendMutation(token: string, retroId: string, type: string, payload: unknown = {}) {
    return app!.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { mutationId: randomUUID(), type, payload },
    });
  }

  beforeAll(async () => {
    const facilitator = await createSignedInUser('facilitator');
    facilitatorId = facilitator.userId;
    facilitatorToken = facilitator.token;

    const participant = await createSignedInUser('participant');
    participantId = participant.userId;
    participantToken = participant.token;

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

    await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${facilitatorToken}` } });

    teamId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/teams',
      headers: { authorization: `Bearer ${facilitatorToken}` },
      payload: { id: teamId, name: 'RN-010 phase test team' },
    });
    await admin.from('profiles').insert({ id: participantId, display_name: 'Participant', email: `${participantId}@example.com` });
    await admin.from('team_members').insert({ team_id: teamId, user_id: participantId!, role: 'member' });
  }, 30000);

  it('a team with no carried-over action items starts in Write, not Review', async () => {
    const templatesRes = await app!.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
    });
    const templateId = templatesRes.json()[0].id as string;
    const { phase } = await createRetro(templateId);
    expect(phase).toBe('write');
  });

  it('a team with an open carried-over action item starts in Review', async () => {
    const templatesRes = await app!.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
    });
    const templateId = templatesRes.json()[0].id as string;

    // The item needs some retro to be sourced from — an earlier one is enough, it's the team-
    // level status that matters (action_items "belong to the team, not a single retro").
    const { retroId: sourceRetroId } = await createRetro(templateId);
    const actionItemId = randomUUID();
    await admin.from('action_items').insert({
      id: actionItemId,
      team_id: teamId!,
      source_retro_id: sourceRetroId,
      title: 'Follow up on the thing',
      status: 'open',
      origin: 'manual',
    });

    const { phase } = await createRetro(templateId);
    expect(phase).toBe('review');

    // Resolve it so later tests in this file (which assume a clean "no carried items" team) see
    // Write again — action_items are team-scoped and outlive this one test.
    await admin.from('action_items').update({ status: 'done' }).eq('id', actionItemId);
  });

  it('the facilitator walks a fresh retro write -> group -> vote, a non-facilitator gets 403, and going back from vote refunds votes', async () => {
    const templatesRes = await app!.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
    });
    const templateId = templatesRes.json()[0].id as string;
    const { retroId, phase } = await createRetro(templateId);
    expect(phase).toBe('write');

    const nonFacilitatorAttempt = await sendMutation(participantToken!, retroId, 'phase.next');
    expect(nonFacilitatorAttempt.statusCode).toBe(403);

    const toGroup = await sendMutation(facilitatorToken!, retroId, 'phase.next');
    expect(toGroup.statusCode).toBe(200);
    expect(toGroup.json().result).toEqual({ phase: 'group' });

    const toVote = await sendMutation(facilitatorToken!, retroId, 'phase.next');
    expect(toVote.statusCode).toBe(200);
    expect(toVote.json().result).toEqual({ phase: 'vote' });

    // card.create is only allowed during Write/Group (RN-010's action matrix) — now in Vote it's
    // rejected with the new phase_not_allowed code.
    const { data: column } = await admin.from('retro_columns').select('id').eq('retro_id', retroId).limit(1).single();
    const cardDuringVote = await sendMutation(facilitatorToken!, retroId, 'card.create', {
      cardId: randomUUID(),
      columnId: column!.id,
      body: 'Should be rejected',
    });
    expect(cardDuringVote.statusCode).toBe(409);
    expect(cardDuringVote.json().error).toBe('phase_not_allowed');

    // Seed a vote directly (vote.add itself is RN-018) so going back has something to refund.
    const { data: topic } = await admin
      .from('topics')
      .insert({ id: randomUUID(), retro_id: retroId, column_id: column!.id, name: 'A topic' })
      .select('id')
      .single();
    await admin.from('votes').insert({ retro_id: retroId, topic_id: topic!.id, user_id: facilitatorId! });
    const { data: beforeRefund } = await admin.from('votes').select('id').eq('retro_id', retroId);
    expect(beforeRefund?.length).toBe(1);

    const back = await sendMutation(facilitatorToken!, retroId, 'phase.back');
    expect(back.statusCode).toBe(200);
    expect(back.json().result).toEqual({ phase: 'group' });

    const { data: afterRefund } = await admin.from('votes').select('id').eq('retro_id', retroId);
    expect(afterRefund).toEqual([]);

    // One more step back: Group -> Write is allowed...
    const backAgain = await sendMutation(facilitatorToken!, retroId, 'phase.back');
    expect(backAgain.statusCode).toBe(200);
    expect(backAgain.json().result).toEqual({ phase: 'write' });

    // ...but Write has no back target.
    const backOnceMore = await sendMutation(facilitatorToken!, retroId, 'phase.back');
    expect(backOnceMore.statusCode).toBe(409);
    expect(backOnceMore.json().error).toBe('phase_not_allowed');
  });

  it('the Action items column follows its own phase rule — creatable in Discuss/Wrap up, not Write/Group, the opposite of regular columns', async () => {
    const templatesRes = await app!.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${facilitatorToken}` },
    });
    const templateId = templatesRes.json()[0].id as string;
    const { retroId, phase } = await createRetro(templateId);
    expect(phase).toBe('write');

    const { data: actionItemsColumn } = await admin
      .from('retro_columns')
      .select('id')
      .eq('retro_id', retroId)
      .eq('kind', 'action_items')
      .single();

    const duringWrite = await sendMutation(facilitatorToken!, retroId, 'card.create', {
      cardId: randomUUID(),
      columnId: actionItemsColumn!.id,
      body: 'Should be rejected during Write',
    });
    expect(duringWrite.statusCode).toBe(409);
    expect(duringWrite.json().error).toBe('phase_not_allowed');

    await sendMutation(facilitatorToken!, retroId, 'phase.next'); // write -> group
    await sendMutation(facilitatorToken!, retroId, 'phase.next'); // group -> vote
    const toDiscuss = await sendMutation(facilitatorToken!, retroId, 'phase.next'); // vote -> discuss
    expect(toDiscuss.json().result).toEqual({ phase: 'discuss' });

    const duringDiscuss = await sendMutation(facilitatorToken!, retroId, 'card.create', {
      cardId: randomUUID(),
      columnId: actionItemsColumn!.id,
      body: 'Follow up on the thing',
    });
    expect(duringDiscuss.statusCode).toBe(200);
  });
}, 30000);
