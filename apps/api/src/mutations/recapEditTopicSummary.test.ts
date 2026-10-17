import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { recapEditTopicSummaryMutation } from './recapEditTopicSummary.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000010';
const otherTopicId = '00000000-0000-4000-8000-000000000011';

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

describe('recap.editTopicSummary', () => {
  it('overwrites the matching topic’s summary in place, leaving other entries untouched', async () => {
    const existing = [
      { topicId, topicName: 'Deploys', summary: 'Old summary.' },
      { topicId: otherTopicId, topicName: 'CI', summary: 'Unrelated.' },
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ topic_summaries: existing }] })
      .mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;

    const retro = retroAt('closed');
    const result = await recapEditTopicSummaryMutation.apply({
      client,
      retro,
      user: facilitator,
      payload: { topicId, summary: 'New summary.' },
    });

    const expected = [
      { topicId, topicName: 'Deploys', summary: 'New summary.' },
      { topicId: otherTopicId, topicName: 'CI', summary: 'Unrelated.' },
    ];
    expect(result).toEqual({ topicSummaries: expected });
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('update retro_recaps set topic_summaries'), [
      JSON.stringify(expected),
      retro.id,
    ]);
  });

  it('rejects a topicId with no summary in the recap', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ topic_summaries: [] }] });
    const client = { query } as unknown as PoolClient;

    await expect(
      recapEditTopicSummaryMutation.apply({
        client,
        retro: retroAt('closed'),
        user: facilitator,
        payload: { topicId, summary: 'New summary.' },
      }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects when no recap row exists yet', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as PoolClient;

    await expect(
      recapEditTopicSummaryMutation.apply({
        client,
        retro: retroAt('closed'),
        user: facilitator,
        payload: { topicId, summary: 'New summary.' },
      }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      recapEditTopicSummaryMutation.apply({
        client,
        retro: retroAt('closed'),
        user: participant,
        payload: { topicId, summary: 'New summary.' },
      }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Closed', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'discuss', 'wrap_up', 'setup']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        recapEditTopicSummaryMutation.apply({
          client,
          retro: retroAt(phase),
          user: facilitator,
          payload: { topicId, summary: 'New summary.' },
        }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
