import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicSkipMutation } from './topicSkip.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000020';

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

function fakeClient(opts: { notFound?: boolean; startedAt?: Date | null; updatedRow?: Record<string, unknown> } = {}) {
  const { notFound = false, startedAt = null, updatedRow } = opts;
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('select started_at from topics')) return Promise.resolve({ rows: notFound ? [] : [{ started_at: startedAt }] });
    if (sql.includes('update topics set started_at = now(), ended_at = now()')) {
      return Promise.resolve({
        rows: [
          {
            id: topicId,
            column_id: '00000000-0000-4000-8000-000000000030',
            name: 'Skipped topic',
            vote_count: 2,
            discussion_order: 'a1',
            started_at: new Date('2026-01-01T00:00:00.000Z'),
            ended_at: new Date('2026-01-01T00:00:00.000Z'),
            ai_group_summary_title: null,
            ai_group_summary: null,
            ai_discussion_questions: null,
            notes: '',
            ...updatedRow,
          },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query } as unknown as PoolClient;
}

const payload = { topicId };

describe('topic.skip', () => {
  it('403s a non-facilitator', async () => {
    const client = fakeClient();
    await expect(topicSkipMutation.apply({ client, retro: retroAt('discuss'), user: participant, payload })).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('409s outside Discuss', async () => {
    const client = fakeClient();
    await expect(topicSkipMutation.apply({ client, retro: retroAt('vote'), user: facilitator, payload })).rejects.toMatchObject({
      status: 409,
      code: 'phase_not_allowed',
    });
  });

  it('404s when the topic does not exist on this retro', async () => {
    const client = fakeClient({ notFound: true });
    await expect(topicSkipMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('409s a topic that has already started', async () => {
    const client = fakeClient({ startedAt: new Date('2026-01-01T00:00:00.000Z') });
    await expect(topicSkipMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload })).rejects.toMatchObject({
      status: 409,
      code: 'already_started',
    });
  });

  it('marks a not-yet-discussed topic as discussed, with no current topic in between', async () => {
    const client = fakeClient();
    const result = await topicSkipMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload });
    expect(result).toMatchObject({ topic: { id: topicId, startedAt: expect.any(String), endedAt: expect.any(String) } });
    const typed = result as { topic: { startedAt: string; endedAt: string } };
    expect(typed.topic.startedAt).toBe(typed.topic.endedAt);
  });
});
