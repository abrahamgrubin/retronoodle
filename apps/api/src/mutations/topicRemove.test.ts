import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicRemoveMutation } from './topicRemove.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000020';
const cardAId = '00000000-0000-4000-8000-000000000021';
const cardBId = '00000000-0000-4000-8000-000000000022';

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

function fakeClient(opts: { notFound?: boolean; startedAt?: Date | null; cardIds?: string[] } = {}) {
  const { notFound = false, startedAt = null, cardIds = [cardAId, cardBId] } = opts;
  const deleteFn = vi.fn();
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('select started_at from topics')) return Promise.resolve({ rows: notFound ? [] : [{ started_at: startedAt }] });
    if (sql.includes('select id from cards where topic_id')) return Promise.resolve({ rows: cardIds.map((id) => ({ id })) });
    if (sql.includes('delete from topics')) {
      deleteFn();
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query, deleteFn } as unknown as PoolClient & { deleteFn: typeof deleteFn };
}

const payload = { topicId };

describe('topic.remove', () => {
  it('403s a non-facilitator', async () => {
    const client = fakeClient();
    await expect(topicRemoveMutation.apply({ client, retro: retroAt('discuss'), user: participant, payload })).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('409s outside Discuss', async () => {
    const client = fakeClient();
    await expect(topicRemoveMutation.apply({ client, retro: retroAt('vote'), user: facilitator, payload })).rejects.toMatchObject({
      status: 409,
      code: 'phase_not_allowed',
    });
  });

  it('404s when the topic does not exist on this retro', async () => {
    const client = fakeClient({ notFound: true });
    await expect(topicRemoveMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('409s a topic that has already started', async () => {
    const client = fakeClient({ startedAt: new Date('2026-01-01T00:00:00.000Z') });
    await expect(topicRemoveMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload })).rejects.toMatchObject({
      status: 409,
      code: 'already_started',
    });
  });

  it('deletes the topic and returns the ids of the cards it ungroups', async () => {
    const client = fakeClient({ cardIds: [cardAId, cardBId] });
    const result = await topicRemoveMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload });
    expect(result).toEqual({ topicId, cardIds: [cardAId, cardBId] });
    expect(client.deleteFn).toHaveBeenCalledTimes(1);
  });

  it('returns an empty cardIds list for an empty topic', async () => {
    const client = fakeClient({ cardIds: [] });
    const result = await topicRemoveMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload });
    expect(result).toEqual({ topicId, cardIds: [] });
  });
});
