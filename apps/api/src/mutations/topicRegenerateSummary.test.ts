import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicRegenerateSummaryMutation } from './topicRegenerateSummary.js';
import type { JobSender, LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
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

const payload = { topicId };

describe('topic.regenerateSummary', () => {
  it('enqueues ai.summarizeTopic and acknowledges the request', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: topicId }] });
    const client = { query } as unknown as PoolClient;
    const send = vi.fn().mockResolvedValue('job-id');
    const jobs: JobSender = { send };

    const result = await topicRegenerateSummaryMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload, jobs });

    expect(result).toEqual({ topicId });
    expect(send).toHaveBeenCalledWith('ai.summarizeTopic', { topicId });
  });

  it('swallows a job-enqueue failure rather than failing the mutation', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: topicId }] });
    const client = { query } as unknown as PoolClient;
    const jobs: JobSender = { send: vi.fn().mockRejectedValue(new Error('queue down')) };

    await expect(
      topicRegenerateSummaryMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload, jobs }),
    ).resolves.toEqual({ topicId });
  });

  it('rejects an unknown topic', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    await expect(
      topicRegenerateSummaryMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      topicRegenerateSummaryMutation.apply({ client, retro: retroAt('discuss'), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Discuss/Wrap up', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        topicRegenerateSummaryMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
