import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '@retronoodle/shared';
import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildServer } from '../server.js';
import type { AuthClaims } from '../auth/index.js';
import { chain } from '../testUtils/supabaseChain.js';
import { testAuthOptions } from '../testUtils/testAuth.js';
import { hashJoinCode } from '../joinCode.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const claims: AuthClaims = { sub: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com' };
const AUTH_HEADER = { authorization: 'Bearer good-token' };

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

describe('POST /teams/:teamId/retros', () => {
  const teamId = '00000000-0000-4000-8000-0000000000aa';
  const templateId = '00000000-0000-4000-8000-0000000000e1';
  const retroId = '00000000-0000-4000-8000-0000000000bb';

  it('a team member can create a retro and gets the join code once — starts in Write, no carried items', async () => {
    const retroRow = {
      id: retroId,
      team_id: teamId,
      name: 'Sprint 1 retro',
      phase: 'write',
      facilitator_id: claims.sub,
      template_id: templateId,
      template_source: 'builtin',
      created_at: new Date().toISOString(),
    };
    const retroCalls: unknown[][] = [];
    const columnsCalls: unknown[][] = [];
    const templateColumns = [
      { title: 'Start', prompt: 'What should we start?', color: 'green' },
      { title: 'Stop', prompt: 'What should we stop?', color: 'pink' },
    ];
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'action_items') return chain({ data: [], error: null });
        if (table === 'templates') {
          return chain({ data: { id: templateId, team_id: null, source: 'builtin', columns: templateColumns }, error: null });
        }
        if (table === 'retros') return chain({ data: retroRow, error: null }, retroCalls);
        if (table === 'retro_columns') return chain({ data: null, error: null }, columnsCalls);
        if (table === 'retro_participants') return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: AUTH_HEADER,
      payload: { id: retroId, name: 'Sprint 1 retro', templateId },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.phase).toBe('write');
    expect(body.facilitatorId).toBe(claims.sub);
    expect(typeof body.joinCode).toBe('string');
    expect(body.joinCode.length).toBeGreaterThan(0);
    expect(retroCalls[0]).toMatchObject([
      'insert',
      {
        id: retroId,
        team_id: teamId,
        facilitator_id: claims.sub,
        template_id: templateId,
        template_source: 'builtin',
        name: 'Sprint 1 retro',
        phase: 'write',
      },
    ]);
    // RN-012: starts its countdown immediately, using Write's own default (5 minutes) — not
    // asserting the exact value (that's phaseDeadline.test.ts's job), just that it's set at all.
    const insertedRetro = retroCalls[0]?.[1] as Record<string, unknown>;
    expect(typeof insertedRetro.phase_deadline).toBe('string');

    // The template's columns are copied in order, plus one Action items column appended last —
    // never stored on the template itself (RN-007).
    const insertedColumns = columnsCalls[0]?.[1] as Array<Record<string, unknown>>;
    expect(insertedColumns).toHaveLength(3);
    expect(insertedColumns[0]).toMatchObject({ retro_id: retroId, title: 'Start', color: 'green', kind: 'standard', position: 0 });
    expect(insertedColumns[1]).toMatchObject({ retro_id: retroId, title: 'Stop', color: 'pink', kind: 'standard', position: 1 });
    expect(insertedColumns[2]).toMatchObject({
      retro_id: retroId,
      title: 'Action items',
      color: 'blue',
      kind: 'action_items',
      position: 2,
    });
  });

  it('starts in Review when the team has an open or in-progress carried-over action item', async () => {
    const retroRow = {
      id: retroId,
      team_id: teamId,
      name: 'Sprint 1 retro',
      phase: 'review',
      facilitator_id: claims.sub,
      template_id: templateId,
      template_source: 'builtin',
      created_at: new Date().toISOString(),
    };
    const retroCalls: unknown[][] = [];
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'action_items') return chain({ data: [{ id: 'some-item' }], error: null });
        if (table === 'templates') {
          return chain({ data: { id: templateId, team_id: null, source: 'builtin', columns: [] }, error: null });
        }
        if (table === 'retros') return chain({ data: retroRow, error: null }, retroCalls);
        if (table === 'retro_columns') return chain({ data: null, error: null });
        if (table === 'retro_participants') return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: AUTH_HEADER,
      payload: { id: retroId, name: 'Sprint 1 retro', templateId },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().phase).toBe('review');
    expect(retroCalls[0]).toMatchObject(['insert', { phase: 'review' }]);
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
      url: `/teams/${teamId}/retros`,
      headers: AUTH_HEADER,
      payload: { id: retroId, name: 'Sprint 1 retro', templateId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a template that belongs to a different team', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'admin' }, error: null });
        if (table === 'action_items') return chain({ data: [], error: null });
        if (table === 'templates') {
          return chain({ data: { id: templateId, team_id: 'some-other-team' }, error: null });
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${teamId}/retros`,
      headers: AUTH_HEADER,
      payload: { id: retroId, name: 'Sprint 1 retro', templateId },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /retros/:id/join-link/regenerate', () => {
  const retroId = '00000000-0000-4000-8000-0000000000cc';

  function retroRow(facilitatorId: string) {
    return {
      id: retroId,
      team_id: '00000000-0000-4000-8000-0000000000aa',
      name: 'Sprint 1 retro',
      phase: 'setup',
      facilitator_id: facilitatorId,
      template_id: '00000000-0000-4000-8000-0000000000e1',
      template_source: 'builtin',
      created_at: new Date().toISOString(),
    };
  }

  it('the facilitator can regenerate the join code', async () => {
    const row = retroRow(claims.sub);
    const updateCalls: unknown[][] = [];
    const supabaseAdmin = {
      from(table: string) {
        if (table !== 'retros') throw new Error(`unexpected table ${table}`);
        return {
          select: () => chain({ data: row, error: null }),
          update: (payload: unknown) => {
            updateCalls.push(['update', payload]);
            return chain({ data: { ...row, ...(payload as object) }, error: null }, updateCalls);
          },
        };
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/join-link/regenerate`,
      headers: AUTH_HEADER,
    });

    expect(res.statusCode).toBe(200);
    expect(typeof res.json().joinCode).toBe('string');
    // updateCalls also picks up the chained .eq()/.select() on the same builder.
    expect(updateCalls[0]?.[0]).toBe('update');
    expect(updateCalls[0]?.[1]).toHaveProperty('join_code_hash');
  });

  it('a non-facilitator (even a team admin) cannot regenerate', async () => {
    const row = retroRow('00000000-0000-4000-8000-000000000999');
    const supabaseAdmin = {
      from(table: string) {
        if (table !== 'retros') throw new Error(`unexpected table ${table}`);
        return { select: () => chain({ data: row, error: null }) };
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/join-link/regenerate`,
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for an unknown retro', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table !== 'retros') throw new Error(`unexpected table ${table}`);
        return { select: () => chain({ data: null, error: null }) };
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/join-link/regenerate`,
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /join/:code', () => {
  const retroId = '00000000-0000-4000-8000-0000000000dd';
  const teamId = '00000000-0000-4000-8000-0000000000aa';
  const code = 'a-valid-join-code';

  function retroRow(phase: string) {
    return {
      id: retroId,
      team_id: teamId,
      name: 'Sprint 1 retro',
      phase,
      facilitator_id: 'someone-else',
      template_id: '00000000-0000-4000-8000-0000000000e1',
      created_at: new Date().toISOString(),
      join_code_hash: hashJoinCode(code),
    };
  }

  it('adds the caller to team_members and retro_participants and returns the retro', async () => {
    const memberUpsertCalls: unknown[][] = [];
    const participantUpsertCalls: unknown[][] = [];
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'retros') return chain({ data: retroRow('setup'), error: null });
        if (table === 'profiles') return chain({ data: { id: claims.sub }, error: null });
        if (table === 'team_members') return chain({ data: null, error: null }, memberUpsertCalls);
        if (table === 'retro_participants') return chain({ data: null, error: null }, participantUpsertCalls);
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/join/${code}`, headers: AUTH_HEADER });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ retroId, teamId, phase: 'setup' });
    expect(memberUpsertCalls[0]).toEqual([
      'upsert',
      { team_id: teamId, user_id: claims.sub, role: 'member' },
      { onConflict: 'team_id,user_id', ignoreDuplicates: true },
    ]);
    expect(participantUpsertCalls[0]).toEqual([
      'upsert',
      { retro_id: retroId, user_id: claims.sub },
      { onConflict: 'retro_id,user_id', ignoreDuplicates: true },
    ]);
  });

  it('returns 404 (invalid link) for an unknown code, including a regenerated old one', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table !== 'retros') throw new Error(`unexpected table ${table}`);
        return chain({ data: null, error: null });
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/join/${code}`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'invalid_link' });
  });

  it('returns 410 (retro closed) once the retro is closed', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table !== 'retros') throw new Error(`unexpected table ${table}`);
        return chain({ data: retroRow('closed'), error: null });
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/join/${code}`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: 'retro_closed', teamId });
  });
});

describe('GET /teams/:teamId/retros', () => {
  const teamId = '00000000-0000-4000-8000-0000000000aa';

  it('lists the team\'s retros, newest first', async () => {
    const rows = [
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        name: 'Sprint 2 retro',
        phase: 'closed',
        created_at: '2026-01-02T00:00:00.000Z',
        closed_at: '2026-01-02T01:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-0000000000c2',
        name: 'Sprint 1 retro',
        phase: 'closed',
        created_at: '2026-01-01T00:00:00.000Z',
        closed_at: '2026-01-01T01:00:00.000Z',
      },
    ];
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'retros') return chain({ data: rows, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/retros`, headers: AUTH_HEADER });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: rows[0]!.id, name: 'Sprint 2 retro', phase: 'closed', closedAt: rows[0]!.closed_at });
    expect(Array.isArray(body)).toBe(true);
  });

  it('a non-member gets 403', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/retros`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(403);
  });
});
