import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { queueReorderMutation } from './queueReorder.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
const columnId = '00000000-0000-4000-8000-000000000020';
const topicId = '00000000-0000-4000-8000-000000000010';

function retroAt(phase: string): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: facilitatorId,
    phase,
    cards_revealed: true,
    phase_deadline: null,
    vote_budget: 3,
  };
}

const payload = { topicId, discussionOrder: 'a1V' };

describe('queue.reorder', () => {
  it('writes the new discussionOrder for a not-yet-discussed topic', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ started_at: null }] }); // lookup
    query.mockResolvedValueOnce({
      rows: [
        {
          id: topicId,
          column_id: columnId,
          name: 'A topic',
          vote_count: 1,
          discussion_order: 'a1V',
          started_at: null,
          ended_at: null,
          ai_group_summary_title: null,
          ai_group_summary: null,
          ai_discussion_questions: null,
        },
      ],
    }); // update
    const client = { query } as unknown as PoolClient;

    const result = await queueReorderMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload });

    expect(result).toEqual({
      topic: {
        id: topicId,
        columnId,
        name: 'A topic',
        voteCount: 1,
        discussionOrder: 'a1V',
        startedAt: null,
        endedAt: null,
        groupSummaryTitle: null,
        groupSummary: null,
        discussionQuestions: null,
      },
    });
  });

  it('rejects a topic that has already started (current or already discussed)', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ started_at: new Date() }] });
    const client = { query } as unknown as PoolClient;
    await expect(
      queueReorderMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 409, code: 'already_started' });
  });

  it('rejects an unknown topic', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    await expect(
      queueReorderMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      queueReorderMutation.apply({ client, retro: retroAt('discuss'), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Discuss', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'wrap_up', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        queueReorderMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
