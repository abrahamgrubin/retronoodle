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

// Same live-project pattern as this repo's other integration tests.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
const hasLiveEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL);

describe.skipIf(!hasLiveEnv)('team action-item list against a live Supabase project (RN-024)', () => {
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const pool = createPool(DATABASE_URL || 'postgresql://localhost/nonexistent');

  let app: FastifyInstance | undefined;
  let teamId: string | undefined;
  let retroId: string | undefined;
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await app?.close();
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
    await pool.end();
  });

  async function createTeamMember(label: string) {
    const email = `rn024-${label}-${randomUUID()}@example.com`;
    const password = `Rn024-${randomUUID()}!`;
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

    const email = `rn024-owner-${randomUUID()}@example.com`;
    const password = `Rn024-${randomUUID()}!`;
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
      payload: { id: teamId, name: 'RN-024 actions test team' },
    });

    const templatesRes = await app.inject({
      method: 'GET',
      url: `/teams/${teamId}/templates`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const templateId = templatesRes.json()[0].id as string;

    retroId = randomUUID();
    await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { id: retroId, name: 'RN-024 source retro', templateId },
    });
  }, 30000);

  it('lists the team\'s items (owner and non-owner alike), with owner and retro names joined', async () => {
    const owner = await createTeamMember('list-owner');
    const bystander = await createTeamMember('list-bystander');
    const itemId = randomUUID();
    await admin.from('action_items').insert({
      id: itemId,
      team_id: teamId!,
      source_retro_id: retroId!,
      title: 'Write the runbook',
      owner_id: owner.userId,
      due_date: '2026-03-01',
      status: 'open',
      origin: 'manual',
    });

    const res = await app!.inject({ method: 'GET', url: `/teams/${teamId}/actions`, headers: { authorization: `Bearer ${bystander.token}` } });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { id: string }) => i.id === itemId);
    expect(item).toMatchObject({
      title: 'Write the runbook',
      ownerId: owner.userId,
      dueDate: '2026-03-01',
      status: 'open',
      origin: 'manual',
      sourceRetroId: retroId,
      sourceRetroName: 'RN-024 source retro',
    });
    expect(typeof item.ownerName).toBe('string');
    expect(item.ownerName.length).toBeGreaterThan(0);
  });

  it('a non-member gets 403', async () => {
    const outsiderEmail = `rn024-outsider-${randomUUID()}@example.com`;
    const password = `Rn024-${randomUUID()}!`;
    const { data: created } = await admin.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
    createdUserIds.push(created!.user!.id);
    const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: session } = await anon.auth.signInWithPassword({ email: outsiderEmail, password });
    const token = session!.session!.access_token;
    await app!.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });

    const res = await app!.inject({ method: 'GET', url: `/teams/${teamId}/actions`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('changing status stamps/clears completed_at and records history with actor and time, visible to any member', async () => {
    const actor = await createTeamMember('status-actor');
    const otherMember = await createTeamMember('status-reader');
    const itemId = randomUUID();
    await admin.from('action_items').insert({
      id: itemId,
      team_id: teamId!,
      source_retro_id: retroId!,
      title: 'Automate the deploy',
      status: 'open',
      origin: 'manual',
    });

    const toDone = await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/actions/${itemId}/status`,
      headers: { authorization: `Bearer ${actor.token}` },
      payload: { status: 'done' },
    });
    expect(toDone.statusCode).toBe(200);
    expect(toDone.json().item.status).toBe('done');
    expect(toDone.json().item.completedAt).not.toBeNull();

    const reopened = await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/actions/${itemId}/status`,
      headers: { authorization: `Bearer ${otherMember.token}` }, // any member, not just who set it done
      payload: { status: 'in_progress' },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().item.status).toBe('in_progress');
    expect(reopened.json().item.completedAt).toBeNull();

    const history = await app!.inject({
      method: 'GET',
      url: `/teams/${teamId}/actions/${itemId}/history`,
      headers: { authorization: `Bearer ${otherMember.token}` },
    });
    expect(history.statusCode).toBe(200);
    const entries = history.json().entries as Array<{ fromStatus: string; toStatus: string; actorId: string }>;
    expect(entries).toHaveLength(2);
    // Newest first.
    expect(entries[0]).toMatchObject({ fromStatus: 'done', toStatus: 'in_progress', actorId: otherMember.userId });
    expect(entries[1]).toMatchObject({ fromStatus: 'open', toStatus: 'done', actorId: actor.userId });
  });

  it('404s a status change for an item outside this team', async () => {
    const member = await createTeamMember('wrong-team');
    const res = await app!.inject({
      method: 'POST',
      url: `/teams/${teamId}/actions/${randomUUID()}/status`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(404);
  });
}, 30000);
