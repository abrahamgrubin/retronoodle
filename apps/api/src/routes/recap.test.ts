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
const retroId = '00000000-0000-4000-8000-0000000000aa';
const ownerId = '00000000-0000-4000-8000-000000000050';

function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token === 'good-token') return Promise.resolve(claims);
  throw new Error('invalid token');
}

function retroRow(phase: string, facilitatorId = '00000000-0000-4000-8000-000000000099') {
  return {
    team_id: '00000000-0000-4000-8000-0000000000bb',
    facilitator_id: facilitatorId,
    phase,
    name: 'Sprint 1 retro',
  };
}

function teamMembersChain(teamRole: 'admin' | 'member' | null) {
  return { select: () => ({ eq: () => ({ eq: () => ({ async maybeSingle() { return { data: teamRole ? { role: teamRole } : null, error: null }; } }) }) }) };
}

interface BuildOpts {
  phase?: string;
  facilitatorId?: string;
  recapRow?: unknown;
  topics?: unknown[];
  topicSummaries?: unknown[];
  actionItems?: unknown[];
  participants?: unknown[];
  profiles?: unknown[];
}

function build(teamRole: 'admin' | 'member' | null, opts: BuildOpts = {}) {
  const {
    phase = 'closed',
    facilitatorId,
    recapRow = { additional_notes: '' },
    topics = [],
    topicSummaries = [],
    actionItems = [],
    participants = [],
    profiles = [],
  } = opts;

  const supabaseAdmin = {
    from(table: string) {
      if (table === 'retros') return chain({ data: retroRow(phase, facilitatorId), error: null });
      if (table === 'team_members') return teamMembersChain(teamRole);
      if (table === 'retro_recaps') return chain({ data: recapRow, error: null });
      if (table === 'topics') return chain({ data: topics, error: null });
      if (table === 'topic_summaries') return chain({ data: topicSummaries, error: null });
      if (table === 'action_items') return chain({ data: actionItems, error: null });
      if (table === 'retro_participants') return chain({ data: participants, error: null });
      if (table === 'profiles') return chain({ data: profiles, error: null });
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return buildServer({
    webOrigin: 'http://localhost:5173',
    auth: testAuthOptions({ verifyAccessToken, supabaseAdmin }),
  });
}

const deploysId = '00000000-0000-4000-8000-000000000010';
const testingId = '00000000-0000-4000-8000-000000000030';
const onboardingId = '00000000-0000-4000-8000-000000000040';
const facilitatorUserId = '00000000-0000-4000-8000-000000000099';

describe('GET /retros/:id/recap', () => {
  it('builds the recap from what Wrap up showed', async () => {
    app = await build('member', {
      recapRow: { additional_notes: 'Great retro overall.' },
      topics: [
        { id: onboardingId, name: 'Onboarding', ai_group_summary_title: null, discussion_order: 'b', started_at: '2026-01-01T00:10:00.000Z' },
        { id: testingId, name: 'Testing', ai_group_summary_title: null, discussion_order: 'c', started_at: null },
        { id: deploysId, name: 'deploy stuff', ai_group_summary_title: 'Deploys', discussion_order: 'a', started_at: '2026-01-01T00:00:00.000Z' },
      ],
      // Ordered topic_id, version desc — the route keeps only each topic's first (latest) row.
      topicSummaries: [
        { topic_id: deploysId, version: 2, key_points: [{ text: 'Deploys are slow', sources: [] }], decisions: [{ text: 'Switch runners', sources: [] }] },
        { topic_id: deploysId, version: 1, key_points: [{ text: 'Old draft', sources: [] }], decisions: [] },
      ],
      actionItems: [
        { id: '00000000-0000-4000-8000-000000000021', title: 'Write docs', owner_id: null, status: 'in_progress', created_at: '2026-01-01T00:20:00.000Z' },
        { id: '00000000-0000-4000-8000-000000000020', title: 'Fix CI', owner_id: ownerId, status: 'open', created_at: '2026-01-01T00:05:00.000Z' },
      ],
      participants: [{ user_id: claims.sub }, { user_id: facilitatorUserId }],
      profiles: [
        { id: ownerId, display_name: 'Owner Name' },
        { id: claims.sub, display_name: 'Ada Lovelace' },
        { id: facilitatorUserId, display_name: 'Zed Facilitator' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retroName).toBe('Sprint 1 retro');
    expect(body.isFacilitator).toBe(false);
    expect(body.recap.topicSummaries).toEqual([
      { topicId: deploysId, topicName: 'Deploys', summary: 'Deploys are slow. Decisions: Switch runners.' },
      { topicId: onboardingId, topicName: 'Onboarding', summary: null },
    ]);
    expect(body.recap.actionItems).toEqual([
      { id: '00000000-0000-4000-8000-000000000020', title: 'Fix CI', ownerName: 'Owner Name', status: 'open' },
      { id: '00000000-0000-4000-8000-000000000021', title: 'Write docs', ownerName: null, status: 'in_progress' },
    ]);
    expect(body.recap.undiscussedTopics).toEqual([{ topicId: testingId, topicName: 'Testing' }]);
    expect(body.recap.attendance).toEqual([
      { id: facilitatorUserId, displayName: 'Zed Facilitator', isFacilitator: true },
      { id: claims.sub, displayName: 'Ada Lovelace', isFacilitator: false },
    ]);
    expect(body.additionalNotes).toBe('Great retro overall.');
    // No vote counts anywhere in the payload, by design.
    expect(JSON.stringify(body.recap)).not.toContain('vote');
  });

  it('returns an empty recap with no notes when nothing was recorded', async () => {
    app = await build('member', { recapRow: null });
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      recap: { topicSummaries: [], actionItems: [], undiscussedTopics: [], attendance: [] },
      additionalNotes: '',
    });
  });

  it('returns 404 for a retro that is not closed yet', async () => {
    app = await build('member', { phase: 'discuss' });
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a non-member', async () => {
    app = await build(null);
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(403);
  });

  it('reports isFacilitator true for the retro facilitator', async () => {
    app = await build('member', { facilitatorId: claims.sub });
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.json().isFacilitator).toBe(true);
  });
});
