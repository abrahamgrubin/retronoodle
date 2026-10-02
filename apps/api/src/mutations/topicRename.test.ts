import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicRenameMutation } from './topicRename.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000010';
const columnId = '00000000-0000-4000-8000-000000000020';

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

function fakeClient(exists: boolean) {
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: exists ? [{ column_id: columnId, vote_count: 0 }] : [] }); // lookup
  query.mockResolvedValueOnce({ rows: [] }); // update
  return { query } as unknown as PoolClient;
}

const payload = { topicId, name: 'Renamed group' };

describe('topic.rename', () => {
  it("lets anyone rename a group — no ownership check, just the Group-phase gate", async () => {
    const client = fakeClient(true);
    const result = await topicRenameMutation.apply({ client, retro: retroAt('group'), user, payload });
    expect(result).toEqual({ topic: { id: topicId, columnId, name: 'Renamed group', voteCount: 0 } });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[1]).toEqual(['Renamed group', topicId]);
  });

  it('rejects outside Group', async () => {
    for (const phase of ['review', 'write', 'vote', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = fakeClient(true);
      await expect(topicRenameMutation.apply({ client, retro: retroAt(phase), user, payload })).rejects.toMatchObject({
        status: 409,
        code: 'phase_not_allowed',
      });
    }
  });

  it('rejects an unknown topic', async () => {
    const client = fakeClient(false);
    await expect(topicRenameMutation.apply({ client, retro: retroAt('group'), user, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});
