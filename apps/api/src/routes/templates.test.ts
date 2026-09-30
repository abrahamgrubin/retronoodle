import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '@retronoodle/shared';
import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildServer } from '../server.js';
import type { AuthClaims } from '../auth/index.js';
import type { RealtimeBus } from '../realtime/RealtimeBus.js';
import { chain } from '../testUtils/supabaseChain.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const claims: AuthClaims = { sub: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com' };
const AUTH_HEADER = { authorization: 'Bearer good-token' };
const teamId = '00000000-0000-4000-8000-0000000000aa';

function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token !== 'good-token') throw new Error('invalid token');
  return Promise.resolve(claims);
}

function buildWith(supabaseAdmin: SupabaseClient<Database>) {
  return buildServer({
    webOrigin: 'http://localhost:5173',
    auth: { verifyAccessToken, supabaseAdmin, realtimeBus: {} as RealtimeBus },
  });
}

describe('GET /teams/:teamId/templates', () => {
  it('a team member sees the builtin templates', async () => {
    const templates = [
      {
        id: '00000000-0000-4000-8000-0000000000e1',
        team_id: null,
        source: 'builtin',
        name: 'Start / Stop / Continue',
        columns: [{ title: 'Start', prompt: 'p', color: 'green' }],
      },
    ];
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
        if (table === 'templates') return chain({ data: templates, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/templates`, headers: AUTH_HEADER });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ name: 'Start / Stop / Continue', source: 'builtin' });
    expect(body[0].columns).toEqual([{ title: 'Start', prompt: 'p', color: 'green' }]);
  });

  it('a non-member gets 403', async () => {
    const supabaseAdmin = {
      from(table: string) {
        if (table === 'team_members') return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    app = await buildWith(supabaseAdmin);
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/templates`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(403);
  });
});
