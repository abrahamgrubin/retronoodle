import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicSetCurrentMutation } from './topicSetCurrent.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
const columnId = '00000000-0000-4000-8000-000000000020';
const currentTopicId = '00000000-0000-4000-8000-000000000010';
const targetTopicId = '00000000-0000-4000-8000-000000000011';

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
    started_at: null,
    ended_at: null,
    ai_group_summary_title: null,
    ai_group_summary: null,
    ai_discussion_questions: null,
    notes: '',
    ...overrides,
  };
}

describe('topic.setCurrent', () => {
  it('jumping to a never-started topic ends the current one and starts the target', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ started_at: null, ended_at: null }] }); // lookup target
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId, { started_at: new Date() })] }); // endCurrentTopic: find
    query.mockResolvedValueOnce({ rows: [topicRow(currentTopicId, { ended_at: new Date() })] }); // endCurrentTopic: update
    query.mockResolvedValueOnce({ rows: [topicRow(targetTopicId, { started_at: new Date() })] }); // startTopic
    const client = { query } as unknown as PoolClient;

    const result = await topicSetCurrentMutation.apply({
      client,
      retro: retroAt('discuss'),
      user: facilitator,
      payload: { topicId: targetTopicId },
    });

    expect(result).toMatchObject({
      endedTopic: { id: currentTopicId },
      startedTopic: { id: targetTopicId },
    });
  });

  it('jumping to an already-discussed topic reopens it (clears endedAt)', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ started_at: new Date(), ended_at: new Date() }] }); // already discussed
    query.mockResolvedValueOnce({ rows: [] }); // endCurrentTopic: nothing currently current
    query.mockResolvedValueOnce({ rows: [topicRow(targetTopicId, { started_at: new Date(), ended_at: null })] }); // startTopic
    const client = { query } as unknown as PoolClient;

    const result = await topicSetCurrentMutation.apply({
      client,
      retro: retroAt('discuss'),
      user: facilitator,
      payload: { topicId: targetTopicId },
    });

    expect(result).toMatchObject({ startedTopic: { id: targetTopicId, endedAt: null } });
  });

  // Homework: jumping also starts a topic, so it enqueues question-suggester the same way
  // topic.next does.
  it('best-effort enqueues question-suggester for the newly-started topic', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ started_at: null, ended_at: null }] });
    query.mockResolvedValueOnce({ rows: [] }); // nothing currently current
    query.mockResolvedValueOnce({ rows: [topicRow(targetTopicId, { started_at: new Date() })] });
    const client = { query } as unknown as PoolClient;
    const send = vi.fn().mockResolvedValue('job-id');

    await topicSetCurrentMutation.apply({
      client,
      retro: retroAt('discuss'),
      user: facilitator,
      payload: { topicId: targetTopicId },
      jobs: { send },
    });

    expect(send).toHaveBeenCalledWith('ai.suggestQuestions', { topicId: targetTopicId });
  });

  it('jumping to the topic that is already current is a no-op', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ started_at: new Date(), ended_at: null }] });
    const client = { query } as unknown as PoolClient;

    const result = await topicSetCurrentMutation.apply({
      client,
      retro: retroAt('discuss'),
      user: facilitator,
      payload: { topicId: targetTopicId },
    });

    expect(result).toEqual({ endedTopic: null, startedTopic: null });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown topic', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    await expect(
      topicSetCurrentMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload: { topicId: targetTopicId } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      topicSetCurrentMutation.apply({ client, retro: retroAt('discuss'), user: participant, payload: { topicId: targetTopicId } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Discuss', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'wrap_up', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        topicSetCurrentMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload: { topicId: targetTopicId } }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
