import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { voteAddMutation } from './voteAdd.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000010';

function retroAt(phase: string, voteBudget = 3): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: '00000000-0000-4000-8000-000000000003',
    phase,
    cards_revealed: true,
    phase_deadline: null,
    vote_budget: voteBudget,
  };
}

function fakeClient(opts: { topicExists?: boolean; usedCount?: number; myCountAfter?: number; progress?: { done: number; total: number } }) {
  const { topicExists = true, usedCount = 0, myCountAfter = 1, progress = { done: 0, total: 1 } } = opts;
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: topicExists ? [{ x: 1 }] : [] }); // topic lookup
  if (topicExists) {
    query.mockResolvedValueOnce({ rows: [{ count: usedCount }] }); // used count
    if (usedCount < 3) {
      query.mockResolvedValueOnce({ rows: [] }); // insert
      query.mockResolvedValueOnce({ rows: [{ count: myCountAfter }] }); // my count on topic
      query.mockResolvedValueOnce({ rows: [progress] }); // computeVotingProgress
    }
  }
  return { query } as unknown as PoolClient;
}

const payload = { topicId };

describe('vote.add', () => {
  it('adds a dot and returns the new count plus remaining budget', async () => {
    const client = fakeClient({ usedCount: 1, myCountAfter: 2 });
    const result = await voteAddMutation.apply({ client, retro: retroAt('vote'), user, payload });
    expect(result).toEqual({ topicId, myCount: 2, remaining: 1, progress: { done: 0, total: 1 } });
    const insertCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[2] as unknown[];
    expect(insertCall[0]).toContain('insert into votes');
  });

  it('rejects once the budget is fully spent (409 no_votes_left)', async () => {
    const client = fakeClient({ usedCount: 3 });
    await expect(voteAddMutation.apply({ client, retro: retroAt('vote'), user, payload })).rejects.toMatchObject({
      status: 409,
      code: 'no_votes_left',
    });
  });

  it('rejects an unknown topic', async () => {
    const client = fakeClient({ topicExists: false });
    await expect(voteAddMutation.apply({ client, retro: retroAt('vote'), user, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('rejects outside Vote', async () => {
    for (const phase of ['review', 'write', 'group', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = fakeClient({});
      await expect(voteAddMutation.apply({ client, retro: retroAt(phase), user, payload })).rejects.toMatchObject({
        status: 409,
        code: 'phase_not_allowed',
      });
    }
  });

  it("actorPrivateResult reduces the result to just the shared progress", () => {
    const result = { topicId, myCount: 1, remaining: 2, progress: { done: 1, total: 4 } };
    expect(voteAddMutation.actorPrivateResult!(result)).toEqual({ done: 1, total: 4 });
  });
});
