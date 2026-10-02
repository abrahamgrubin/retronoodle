import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicEditSummaryMutation } from './topicEditSummary.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000010';
const summaryId = '00000000-0000-4000-8000-000000000020';
const cardId = '00000000-0000-4000-8000-000000000030';

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

const payload = {
  topicId,
  keyPoints: [{ text: 'Edited key point', sources: [cardId] }],
  decisions: [],
  disagreements: [],
  proposedActionItems: [],
};

function updatedRow() {
  return {
    id: summaryId,
    topic_id: topicId,
    version: 1,
    model: 'claude-sonnet-5',
    prompt_version: 'abc123',
    key_points: payload.keyPoints,
    decisions: [],
    disagreements: [],
    proposed_action_items: [],
    edited: true,
    edit_ratio: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('topic.editSummary', () => {
  it('overwrites the latest summary in place and marks it edited', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: summaryId }] }); // lookup latest
    query.mockResolvedValueOnce({ rows: [updatedRow()] }); // update
    const client = { query } as unknown as PoolClient;

    const result = await topicEditSummaryMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload });

    expect(result).toMatchObject({ summary: { id: summaryId, keyPoints: payload.keyPoints, edited: true } });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[0]).toContain('edited = true');
  });

  it('rejects when there is no summary yet to edit', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    await expect(
      topicEditSummaryMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      topicEditSummaryMutation.apply({ client, retro: retroAt('discuss'), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Discuss/Wrap up', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        topicEditSummaryMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
