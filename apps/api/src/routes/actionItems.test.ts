import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '@retronoodle/shared';
import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildServer } from '../server.js';
import type { AuthClaims } from '../auth/index.js';
import { chain } from '../testUtils/supabaseChain.js';
import { testAuthOptions } from '../testUtils/testAuth.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const claims: AuthClaims = { sub: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com' };
const AUTH_HEADER = { authorization: 'Bearer good-token' };
const teamId = '00000000-0000-4000-8000-0000000000aa';
const itemId = '00000000-0000-4000-8000-0000000000bb';
const ownerId = '00000000-0000-4000-8000-0000000000cc';
const retroId = '00000000-0000-4000-8000-0000000000dd';

function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token !== 'good-token') throw new Error('invalid token');
  return Promise.resolve(claims);
}

function buildWith(supabaseAdmin: SupabaseClient<Database>) {
  return buildServer({
    webOrigin: 'http://localhost:5173',
    auth: testAuthOptions({ verifyAccessToken, supabaseAdmin }),
  });
}

function itemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: itemId,
    team_id: teamId,
    source_retro_id: retroId,
    source_topic_id: null,
    title: 'Ship the thing',
    owner_id: ownerId,
    due_date: '2026-02-01',
    status: 'open',
    origin: 'manual',
    completed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GET /teams/:teamId/actions', () => {
  it('lists this team\'s items with owner and source-retro names joined', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'action_items') return chain({ data: [itemRow()], error: null });
        if (table === 'profiles') return chain({ data: [{ id: ownerId, display_name: 'Alice' }], error: null });
        if (table === 'retros') return chain({ data: [{ id: retroId, name: 'Sprint 1 retro' }], error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/actions`, headers: AUTH_HEADER });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([
      {
        id: itemId,
        title: 'Ship the thing',
        ownerId,
        ownerName: 'Alice',
        dueDate: '2026-02-01',
        status: 'open',
        origin: 'manual',
        completedAt: null,
        sourceRetroId: retroId,
        sourceRetroName: 'Sprint 1 retro',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('a non-member gets 403', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/actions`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /teams/:teamId/actions/:itemId/history', () => {
  it('returns status changes, newest first, with actor names joined', async () => {
    const changes = [
      {
        id: '00000000-0000-4000-8000-0000000000ee',
        action_item_id: itemId,
        from_status: 'open',
        to_status: 'done',
        actor_id: claims.sub,
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ];
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'action_items') return chain({ data: { id: itemId }, error: null });
        if (table === 'action_item_status_changes') return chain({ data: changes, error: null });
        if (table === 'profiles') return chain({ data: [{ id: claims.sub, display_name: 'Ada' }], error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/actions/${itemId}/history`, headers: AUTH_HEADER });

    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toEqual([
      {
        id: changes[0]!.id,
        fromStatus: 'open',
        toStatus: 'done',
        actorId: claims.sub,
        actorName: 'Ada',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('404s an item outside this team', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'action_items') return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/actions/${itemId}/history`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /teams/:teamId/actions/:itemId/status', () => {
  it("stamps completed_at on done and records the status change", async () => {
    let actionItemsCalls = 0;
    const updateCalls: unknown[][] = [];
    const insertCalls: unknown[][] = [];
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'action_items') {
          actionItemsCalls += 1;
          if (actionItemsCalls === 1) return chain({ data: { status: 'open' }, error: null });
          return chain({ data: itemRow({ status: 'done', completed_at: '2026-01-03T00:00:00.000Z' }), error: null }, updateCalls);
        }
        if (table === 'action_item_status_changes') return chain({ data: null, error: null }, insertCalls);
        if (table === 'retros') return chain({ data: { name: 'Sprint 1 retro' }, error: null });
        if (table === 'profiles') return chain({ data: { display_name: 'Alice' }, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/actions/${itemId}/status`,
      headers: AUTH_HEADER,
      payload: { status: 'done' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().item).toMatchObject({ status: 'done', completedAt: '2026-01-03T00:00:00.000Z', ownerName: 'Alice', sourceRetroName: 'Sprint 1 retro' });
    const updateCall = updateCalls.find((c) => c[0] === 'update');
    expect(updateCall?.[1]).toMatchObject({ status: 'done', completed_at: expect.any(String) });
    const insertCall = insertCalls.find((c) => c[0] === 'insert');
    expect(insertCall?.[1]).toMatchObject({ action_item_id: itemId, from_status: 'open', to_status: 'done', actor_id: claims.sub });
  });

  it('clears completed_at when reopening from done', async () => {
    let actionItemsCalls = 0;
    const updateCalls: unknown[][] = [];
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'action_items') {
          actionItemsCalls += 1;
          if (actionItemsCalls === 1) return chain({ data: { status: 'done' }, error: null });
          return chain({ data: itemRow({ status: 'open', completed_at: null }), error: null }, updateCalls);
        }
        if (table === 'action_item_status_changes') return chain({ data: null, error: null });
        if (table === 'retros') return chain({ data: { name: 'Sprint 1 retro' }, error: null });
        if (table === 'profiles') return chain({ data: { display_name: 'Alice' }, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/actions/${itemId}/status`,
      headers: AUTH_HEADER,
      payload: { status: 'open' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().item).toMatchObject({ status: 'open', completedAt: null });
    const updateCall = updateCalls.find((c) => c[0] === 'update');
    expect(updateCall?.[1]).toMatchObject({ status: 'open', completed_at: null });
  });

  it('404s an item outside this team', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'action_items') return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/actions/${itemId}/status`,
      headers: AUTH_HEADER,
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s an invalid status', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/actions/${itemId}/status`,
      headers: AUTH_HEADER,
      payload: { status: 'not_a_real_status' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a non-member gets 403', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/actions/${itemId}/status`,
      headers: AUTH_HEADER,
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(403);
  });
});
