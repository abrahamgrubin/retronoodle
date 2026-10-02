import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { voteRemoveMutation } from './voteRemove.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000010';

function retroAt(phase: string): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: '00000000-0000-4000-8000-000000000003',
    phase,
    cards_revealed: true,
    phase_deadline: null,
    vote_budget: 3,
  };
}

function fakeClient(opts: {
  deleted?: boolean;
  myCountAfter?: number;
  usedCountAfter?: number;
  progress?: { done: number; total: number };
}) {
  const { deleted = true, myCountAfter = 0, usedCountAfter = 1, progress = { done: 0, total: 1 } } = opts;
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: deleted ? [{ id: 'some-vote-id' }] : [] }); // delete
  if (deleted) {
    query.mockResolvedValueOnce({ rows: [{ count: myCountAfter }] }); // my count on topic
    query.mockResolvedValueOnce({ rows: [{ count: usedCountAfter }] }); // total used
    query.mockResolvedValueOnce({ rows: [progress] }); // computeVotingProgress
  }
  return { query } as unknown as PoolClient;
}

const payload = { topicId };

describe('vote.remove', () => {
  it('removes one dot and returns the updated count plus remaining budget', async () => {
    const client = fakeClient({ myCountAfter: 1, usedCountAfter: 2 });
    const result = await voteRemoveMutation.apply({ client, retro: retroAt('vote'), user, payload });
    expect(result).toEqual({ topicId, myCount: 1, remaining: 1, progress: { done: 0, total: 1 } });
    const deleteCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(deleteCall[0]).toContain('delete from votes');
  });

  it('rejects when there are no votes on this topic to remove', async () => {
    const client = fakeClient({ deleted: false });
    await expect(voteRemoveMutation.apply({ client, retro: retroAt('vote'), user, payload })).rejects.toMatchObject({
      status: 409,
      code: 'no_votes_on_topic',
    });
  });

  it('rejects outside Vote', async () => {
    for (const phase of ['review', 'write', 'group', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = fakeClient({});
      await expect(voteRemoveMutation.apply({ client, retro: retroAt(phase), user, payload })).rejects.toMatchObject({
        status: 409,
        code: 'phase_not_allowed',
      });
    }
  });
});
