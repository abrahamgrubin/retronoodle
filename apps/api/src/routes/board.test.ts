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
const otherClaims: AuthClaims = { sub: '00000000-0000-4000-8000-000000000002', email: 'bob@example.com' };
const AUTH_HEADER = { authorization: 'Bearer good-token' };
const OTHER_AUTH_HEADER = { authorization: 'Bearer other-token' };
const retroId = '00000000-0000-4000-8000-0000000000aa';

function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token === 'good-token') return Promise.resolve(claims);
  if (token === 'other-token') return Promise.resolve(otherClaims);
  throw new Error('invalid token');
}

const retroRow = {
  id: retroId,
  team_id: '00000000-0000-4000-8000-0000000000bb',
  facilitator_id: '00000000-0000-4000-8000-000000000099',
  template_id: '00000000-0000-4000-8000-0000000000e1',
  template_source: 'builtin',
  name: 'Sprint 1 retro',
  phase: 'write',
  cards_revealed: false,
  created_at: new Date().toISOString(),
};

const columnRow = {
  id: '00000000-0000-4000-8000-0000000000c1',
  title: 'Start',
  prompt: 'p',
  color: 'green',
  kind: 'standard',
  position: 0,
};

const cardRow = {
  id: '00000000-0000-4000-8000-0000000000d1',
  column_id: columnRow.id,
  author_id: claims.sub,
  body: 'Ship it',
  position: 'a0',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function build(teamRole: 'admin' | 'member' | null) {
  const supabaseAdmin = {
    from(table: string) {
      if (table === 'retros') return chain({ data: retroRow, error: null });
      if (table === 'team_members') return chain({ data: teamRole ? { role: teamRole } : null, error: null });
      if (table === 'retro_columns') return chain({ data: [columnRow], error: null });
      if (table === 'cards') return chain({ data: [cardRow], error: null });
      if (table === 'profiles') return chain({ data: [{ id: claims.sub, display_name: 'Ada Lovelace' }], error: null });
      if (table === 'retro_events') return chain({ data: { seq: 3 }, error: null });
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return buildServer({
    webOrigin: 'http://localhost:5173',
    auth: testAuthOptions({ verifyAccessToken, supabaseAdmin }),
  });
}

describe('GET /retros/:id/board', () => {
  it('returns the snapshot for a team member', async () => {
    app = await build('member');
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retro).toMatchObject({ id: retroId, name: 'Sprint 1 retro', phase: 'write', cardsRevealed: false });
    expect(body.columns).toEqual([
      { id: columnRow.id, title: 'Start', prompt: 'p', color: 'green', kind: 'standard', position: 0 },
    ]);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({
      id: cardRow.id,
      authorId: claims.sub,
      authorName: 'Ada Lovelace',
      body: 'Ship it',
    });
    expect(body.seq).toBe(3);
  });

  it('returns 403 for a non-member', async () => {
    app = await build(null);
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(403);
  });

  it('redacts a non-author card during Write before reveal (RN-011)', async () => {
    app = await build('member');
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: OTHER_AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    const card = res.json().cards[0];
    expect(card).toEqual({ id: cardRow.id, columnId: columnRow.id, authorId: claims.sub, position: 'a0', hidden: true });
    expect('body' in card).toBe(false);
  });
});
