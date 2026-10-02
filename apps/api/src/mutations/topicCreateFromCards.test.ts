import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicCreateFromCardsMutation } from './topicCreateFromCards.js';
import type { LockedRetro } from './registry.js';

const authorId = '00000000-0000-4000-8000-000000000004';
const user = { id: authorId, email: 'a@example.com', displayName: 'A', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000010';
const cardAId = '00000000-0000-4000-8000-000000000011';
const cardBId = '00000000-0000-4000-8000-000000000012';
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

function cardRow(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    column_id: columnId,
    author_id: authorId,
    author_name: 'A',
    body: 'Ship it',
    position: 'a0',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    topic_id: null,
    ...overrides,
  };
}

function fakeClient(rows: ReturnType<typeof cardRow>[]) {
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows }); // lookup
  query.mockResolvedValueOnce({ rows: [] }); // insert topics
  query.mockResolvedValueOnce({ rows: [] }); // update cards
  return { query } as unknown as PoolClient;
}

const payload = { topicId, cardIds: [cardAId, cardBId] };

describe('topic.createFromCards', () => {
  it('groups two ungrouped cards in the same column, defaulting the name to the first card\'s text', async () => {
    const client = fakeClient([cardRow(cardAId, { body: 'First card text' }), cardRow(cardBId)]);
    const result = await topicCreateFromCardsMutation.apply({ client, retro: retroAt('group'), user, payload });

    expect(result).toMatchObject({
      topic: { id: topicId, columnId, name: 'First card text' },
      cards: [
        { id: cardAId, topicId },
        { id: cardBId, topicId },
      ],
    });
    const insertCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(insertCall[0]).toContain('insert into topics');
    expect(insertCall[1]).toEqual([topicId, retroAt('group').id, columnId, 'First card text']);
  });

  it('uses an explicit name over the default when given one', async () => {
    const client = fakeClient([cardRow(cardAId), cardRow(cardBId)]);
    const result = await topicCreateFromCardsMutation.apply({
      client,
      retro: retroAt('group'),
      user,
      payload: { ...payload, name: 'Performance issues' },
    });
    expect(result).toMatchObject({ topic: { name: 'Performance issues' } });
  });

  it('rejects outside Group', async () => {
    for (const phase of ['review', 'write', 'vote', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = fakeClient([cardRow(cardAId), cardRow(cardBId)]);
      await expect(
        topicCreateFromCardsMutation.apply({ client, retro: retroAt(phase), user, payload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });

  it('rejects if a card id does not resolve', async () => {
    const client = fakeClient([cardRow(cardAId)]); // only one of the two found
    await expect(
      topicCreateFromCardsMutation.apply({ client, retro: retroAt('group'), user, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects cards from different columns ("groups stay within one column")', async () => {
    const client = fakeClient([cardRow(cardAId), cardRow(cardBId, { column_id: 'some-other-column' })]);
    await expect(
      topicCreateFromCardsMutation.apply({ client, retro: retroAt('group'), user, payload }),
    ).rejects.toMatchObject({ status: 400, code: 'different_columns' });
  });

  it('rejects if either card is already grouped', async () => {
    const client = fakeClient([cardRow(cardAId, { topic_id: 'already-a-topic' }), cardRow(cardBId)]);
    await expect(
      topicCreateFromCardsMutation.apply({ client, retro: retroAt('group'), user, payload }),
    ).rejects.toMatchObject({ status: 409, code: 'already_grouped' });
  });
});
