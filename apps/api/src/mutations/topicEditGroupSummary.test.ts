import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicEditGroupSummaryMutation } from './topicEditGroupSummary.js';
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

const payload = { topicId, title: 'Edited title', summary: "The facilitator's own summary." };

function updatedRow() {
  return {
    id: topicId,
    column_id: columnId,
    name: 'A topic',
    vote_count: 2,
    discussion_order: 'a0',
    started_at: null,
    ended_at: null,
    ai_group_summary_title: payload.title,
    ai_group_summary: payload.summary,
    ai_discussion_questions: null,
    notes: '',
  };
}

describe('topic.editGroupSummary', () => {
  it('overwrites the group summary for the facilitator', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: topicId }] }); // lookup
    query.mockResolvedValueOnce({ rows: [updatedRow()] }); // update
    const client = { query } as unknown as PoolClient;

    const result = await topicEditGroupSummaryMutation.apply({ client, retro: retroAt('vote'), user: facilitator, payload });

    expect(result).toMatchObject({ topic: { id: topicId, groupSummaryTitle: payload.title, groupSummary: payload.summary } });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[1]).toEqual([payload.title, payload.summary, topicId]);
  });

  it('overwrites even when group-summarizer never ran (null before)', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: topicId }] });
    query.mockResolvedValueOnce({ rows: [updatedRow()] });
    const client = { query } as unknown as PoolClient;

    await expect(
      topicEditGroupSummaryMutation.apply({ client, retro: retroAt('vote'), user: facilitator, payload }),
    ).resolves.toMatchObject({ topic: { groupSummary: payload.summary } });
  });

  it('rejects an unknown topic', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    await expect(
      topicEditGroupSummaryMutation.apply({ client, retro: retroAt('vote'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      topicEditGroupSummaryMutation.apply({ client, retro: retroAt('vote'), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Vote', async () => {
    for (const phase of ['review', 'write', 'group', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        topicEditGroupSummaryMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
