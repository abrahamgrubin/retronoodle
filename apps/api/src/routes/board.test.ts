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
  phase_deadline: '2026-01-01T00:05:00.000Z',
  vote_budget: 3,
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
  topic_id: null,
};

const suggestionRow = {
  id: '00000000-0000-4000-8000-0000000000f1',
  name: 'Suggested group',
  card_ids: [cardRow.id, '00000000-0000-4000-8000-0000000000f2'],
};

function build(teamRole: 'admin' | 'member' | null, opts: { facilitatorId?: string } = {}) {
  const retro = opts.facilitatorId ? { ...retroRow, facilitator_id: opts.facilitatorId } : retroRow;
  const supabaseAdmin = {
    from(table: string) {
      if (table === 'retros') return chain({ data: retro, error: null });
      if (table === 'team_members') return chain({ data: teamRole ? { role: teamRole } : null, error: null });
      if (table === 'retro_columns') return chain({ data: [columnRow], error: null });
      if (table === 'cards') return chain({ data: [cardRow], error: null });
      if (table === 'topics') return chain({ data: [], error: null });
      if (table === 'card_reactions') return chain({ data: [], error: null });
      if (table === 'group_suggestions') return chain({ data: [suggestionRow], error: null });
      if (table === 'votes') return chain({ data: [], error: null });
      if (table === 'retro_participants') return chain({ data: [], error: null });
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
    expect(body.retro).toMatchObject({
      id: retroId,
      name: 'Sprint 1 retro',
      phase: 'write',
      cardsRevealed: false,
      phaseDeadline: '2026-01-01T00:05:00.000Z',
      voteBudget: 3,
    });
    expect(typeof body.serverTime).toBe('string');
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
    expect(body.topics).toEqual([]);
    expect(body.suggestions).toBeNull(); // not the facilitator
    expect(body.myVotes).toEqual([]);
    expect(body.votingProgress).toBeNull(); // not in Vote phase
    expect(body.seq).toBe(3);
  });

  it("RN-017: includes pending suggestions for the facilitator, deriving each one's columnId from its cards", async () => {
    app = await build('member', { facilitatorId: claims.sub });
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/board`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toEqual([
      { id: suggestionRow.id, name: 'Suggested group', columnId: columnRow.id, cardIds: suggestionRow.card_ids },
    ]);
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
    expect(card).toEqual({ id: cardRow.id, columnId: columnRow.id, authorId: claims.sub, position: 'a0', topicId: null, hidden: true });
    expect('body' in card).toBe(false);
  });
});
