import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { cardAddToTopicMutation } from './cardAddToTopic.js';
import type { LockedRetro } from './registry.js';

const authorId = '00000000-0000-4000-8000-000000000004';
const user = { id: authorId, email: 'a@example.com', displayName: 'A', avatarUrl: null };
const cardId = '00000000-0000-4000-8000-000000000011';
const topicId = '00000000-0000-4000-8000-000000000010';
const oldTopicId = '00000000-0000-4000-8000-000000000015';
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

function lookupRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    card_column_id: columnId,
    author_id: authorId,
    author_name: 'A',
    body: 'Ship it',
    position: 'a0',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    old_topic_id: null,
    topic_column_id: columnId,
    topic_name: 'Existing group',
    ...overrides,
  };
}

function fakeClient(opts: { lookup?: ReturnType<typeof lookupRow>[]; othersLeftInOldTopic?: 0 | 1 | 2 }) {
  const { lookup = [lookupRow()], othersLeftInOldTopic } = opts;
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: lookup }); // lookup
  query.mockResolvedValueOnce({ rows: [] }); // update cards set topic_id
  if (othersLeftInOldTopic !== undefined) {
    const member = {
      id: '00000000-0000-4000-8000-000000000099',
      column_id: columnId,
      author_id: authorId,
      author_name: 'A',
      body: 'Still here',
      position: 'a0',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const rows = othersLeftInOldTopic === 2 ? [member, member] : othersLeftInOldTopic === 1 ? [member] : [];
    query.mockResolvedValueOnce({ rows }); // dissolveIfOrphaned's "who's left"
    if (othersLeftInOldTopic !== 2) query.mockResolvedValueOnce({ rows: [] }); // delete from topics
  }
  return { query } as unknown as PoolClient;
}

const payload = { cardId, topicId };

describe('card.addToTopic', () => {
  it('joins an ungrouped card to an existing group', async () => {
    const client = fakeClient({});
    const result = await cardAddToTopicMutation.apply({ client, retro: retroAt('group'), user, payload });

    expect(result).toMatchObject({
      topic: { id: topicId, columnId, name: 'Existing group' },
      card: { id: cardId, topicId },
      dissolvedTopic: null,
    });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[0]).toContain('update cards');
    expect(updateCall[1]).toEqual([topicId, cardId]);
  });

  it('dissolves the card\'s previous group if joining a new one leaves it with one member', async () => {
    const client = fakeClient({ lookup: [lookupRow({ old_topic_id: oldTopicId })], othersLeftInOldTopic: 1 });
    const result = await cardAddToTopicMutation.apply({ client, retro: retroAt('group'), user, payload });
    expect(result).toMatchObject({ dissolvedTopic: { topicId: oldTopicId } });
  });

  it('does not dissolve anything when the previous group still has other members', async () => {
    const client = fakeClient({ lookup: [lookupRow({ old_topic_id: oldTopicId })], othersLeftInOldTopic: 2 });
    const result = await cardAddToTopicMutation.apply({ client, retro: retroAt('group'), user, payload });
    expect(result).toMatchObject({ dissolvedTopic: null });
  });

  it('rejects outside Group', async () => {
    for (const phase of ['review', 'write', 'vote', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = fakeClient({});
      await expect(cardAddToTopicMutation.apply({ client, retro: retroAt(phase), user, payload })).rejects.toMatchObject({
        status: 409,
        code: 'phase_not_allowed',
      });
    }
  });

  it('rejects an unknown card', async () => {
    const client = fakeClient({ lookup: [] });
    await expect(cardAddToTopicMutation.apply({ client, retro: retroAt('group'), user, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('rejects an unknown topic', async () => {
    const client = fakeClient({ lookup: [lookupRow({ topic_column_id: null, topic_name: null })] });
    await expect(cardAddToTopicMutation.apply({ client, retro: retroAt('group'), user, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('rejects joining a group in a different column ("groups stay within one column")', async () => {
    const client = fakeClient({ lookup: [lookupRow({ topic_column_id: 'some-other-column' })] });
    await expect(cardAddToTopicMutation.apply({ client, retro: retroAt('group'), user, payload })).rejects.toMatchObject({
      status: 400,
      code: 'wrong_column',
    });
  });
});
