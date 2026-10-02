import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicNextMutation } from './topicNext.js';
import type { JobSender, LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
const columnId = '00000000-0000-4000-8000-000000000020';
const currentTopicId = '00000000-0000-4000-8000-000000000010';
const nextTopicId = '00000000-0000-4000-8000-000000000011';

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

function topicRow(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    column_id: columnId,
    name: 'A topic',
    vote_count: 2,
    discussion_order: 'a0',
    started_at: new Date('2026-01-01T00:00:00.000Z'),
    ended_at: null,
    ...overrides,
  };
}

describe('topic.next', () => {
  it('ends the current topic and starts the first one in the up-next queue', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId)] }); // endCurrentTopic: find current
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId, { ended_at: new Date('2026-01-01T00:10:00.000Z') })] }); // endCurrentTopic: update
    query.mockResolvedValueOnce({ rows: [{ id: nextTopicId }] }); // up-next lookup
    query.mockResolvedValueOnce({ rows: [topicRow(nextTopicId, { started_at: new Date('2026-01-01T00:10:00.000Z') })] }); // startTopic: update
    const client = { query } as unknown as PoolClient;

    const result = await topicNextMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload: {} });

    expect(result).toMatchObject({
      endedTopic: { id: currentTopicId, endedAt: expect.any(String) },
      startedTopic: { id: nextTopicId, startedAt: expect.any(String) },
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('starts nothing when the up-next queue is empty — "Finish discussion"', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId)] });
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId, { ended_at: new Date() })] });
    query.mockResolvedValueOnce({ rows: [] }); // nothing left up next
    const client = { query } as unknown as PoolClient;

    const result = await topicNextMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload: {} });

    expect(result).toMatchObject({ endedTopic: { id: currentTopicId }, startedTopic: null });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('starts the first topic even when nothing was current yet', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [] }); // endCurrentTopic: nothing current
    query.mockResolvedValueOnce({ rows: [{ id: nextTopicId }] });
    query.mockResolvedValueOnce({ rows: [topicRow(nextTopicId, { started_at: new Date() })] });
    const client = { query } as unknown as PoolClient;

    const result = await topicNextMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload: {} });

    expect(result).toMatchObject({ endedTopic: null, startedTopic: { id: nextTopicId } });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('best-effort enqueues the ended topic\'s summary job', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId)] });
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId, { ended_at: new Date() })] });
    query.mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    const send = vi.fn().mockResolvedValue('job-id');
    const jobs: JobSender = { send };

    await topicNextMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload: {}, jobs });

    expect(send).toHaveBeenCalledWith('ai.summarizeTopic', { topicId: currentTopicId });
  });

  it('swallows a job-enqueue failure rather than failing the mutation', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId)] });
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId, { ended_at: new Date() })] });
    query.mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    const jobs: JobSender = { send: vi.fn().mockRejectedValue(new Error('queue down')) };

    await expect(
      topicNextMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload: {}, jobs }),
    ).resolves.toMatchObject({ endedTopic: { id: currentTopicId } });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      topicNextMutation.apply({ client, retro: retroAt('discuss'), user: participant, payload: {} }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Discuss', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'wrap_up', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        topicNextMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload: {} }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
