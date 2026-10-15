import { afterEach, describe, expect, it, vi } from 'vitest';
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
  actionItems?: unknown[];
  undiscussedTopics?: unknown[];
  participants?: unknown[];
  profiles?: unknown[];
  jobsSend?: (queueName: string, data: object) => Promise<string | null>;
}

function build(teamRole: 'admin' | 'member' | null, opts: BuildOpts = {}) {
  const {
    phase = 'closed',
    facilitatorId,
    recapRow = { status: 'ready', topic_summaries: [], decisions: [], generated_at: '2026-01-01T00:00:00.000Z' },
    actionItems = [],
    undiscussedTopics = [],
    participants = [],
    profiles = [],
    jobsSend,
  } = opts;

  const supabaseAdmin = {
    from(table: string) {
      if (table === 'retros') return chain({ data: retroRow(phase, facilitatorId), error: null });
      if (table === 'team_members') return teamMembersChain(teamRole);
      if (table === 'retro_recaps') {
        return {
          ...chain({ data: recapRow, error: null }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === 'action_items') return chain({ data: actionItems, error: null });
      if (table === 'topics') return chain({ data: undiscussedTopics, error: null });
      if (table === 'retro_participants') return chain({ data: participants, error: null });
      if (table === 'profiles') return chain({ data: profiles, error: null });
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return buildServer({
    webOrigin: 'http://localhost:5173',
    auth: testAuthOptions({ verifyAccessToken, supabaseAdmin, jobs: jobsSend ? { send: jobsSend } : undefined }),
  });
}

describe('GET /retros/:id/recap', () => {
  it('returns the assembled recap for a team member once ready', async () => {
    app = await build('member', {
      recapRow: {
        status: 'ready',
        topic_summaries: [{ topicId: '00000000-0000-4000-8000-000000000010', topicName: 'Deploys', summary: 'Deploys are slow.' }],
        decisions: [{ topicId: '00000000-0000-4000-8000-000000000010', topicName: 'Deploys', text: 'Switch runners.' }],
        generated_at: '2026-01-01T00:00:00.000Z',
      },
      actionItems: [{ id: '00000000-0000-4000-8000-000000000020', title: 'Fix CI', owner_id: ownerId, status: 'open' }],
      undiscussedTopics: [{ id: '00000000-0000-4000-8000-000000000030', name: 'Testing' }],
      participants: [{ user_id: claims.sub }],
      profiles: [
        { id: ownerId, display_name: 'Owner Name' },
        { id: claims.sub, display_name: 'Ada Lovelace' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.retroName).toBe('Sprint 1 retro');
    expect(body.isFacilitator).toBe(false);
    expect(body.recap.topicSummaries).toEqual([
      { topicId: '00000000-0000-4000-8000-000000000010', topicName: 'Deploys', summary: 'Deploys are slow.' },
    ]);
    expect(body.recap.decisions).toEqual([
      { topicId: '00000000-0000-4000-8000-000000000010', topicName: 'Deploys', text: 'Switch runners.' },
    ]);
    expect(body.recap.actionItems).toEqual([{ id: '00000000-0000-4000-8000-000000000020', title: 'Fix CI', ownerName: 'Owner Name', status: 'open' }]);
    expect(body.recap.undiscussedTopics).toEqual([{ topicId: '00000000-0000-4000-8000-000000000030', topicName: 'Testing' }]);
    expect(body.recap.attendance).toEqual([{ id: claims.sub, displayName: 'Ada Lovelace' }]);
    expect(body.recap.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    // No vote counts anywhere in the payload, by design.
    expect(JSON.stringify(body.recap)).not.toContain('vote');
  });

  it('returns status without a recap while still pending', async () => {
    app = await build('member', { recapRow: { status: 'pending', topic_summaries: [], decisions: [], generated_at: null } });
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'pending', recap: null });
  });

  it('returns status without a recap when unavailable', async () => {
    app = await build('member', { recapRow: { status: 'unavailable', topic_summaries: [], decisions: [], generated_at: null } });
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'unavailable', recap: null });
  });

  it('self-heals by seeding a pending row and enqueuing the job when none exists yet', async () => {
    const jobsSend = vi.fn().mockResolvedValue('job-id');
    app = await build('member', { recapRow: null, jobsSend });
    const res = await app.inject({ method: 'GET', url: `/retros/${retroId}/recap`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'pending', recap: null });
    expect(jobsSend).toHaveBeenCalledWith('ai.generateRecap', { retroId });
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
