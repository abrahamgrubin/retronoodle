import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { suggestionAcceptMutation } from './suggestionAccept.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
const suggestionId = '00000000-0000-4000-8000-000000000010';
const cardAId = '00000000-0000-4000-8000-000000000011';
const cardBId = '00000000-0000-4000-8000-000000000012';
const columnId = '00000000-0000-4000-8000-000000000020';

function retroAt(phase: string): LockedRetro {
  return { id: '00000000-0000-4000-8000-000000000001', team_id: '00000000-0000-4000-8000-000000000002', facilitator_id: facilitatorId, phase, cards_revealed: true, phase_deadline: null, vote_budget: 3 };
}

function cardRow(id: string): {
  id: string;
  column_id: string;
  author_id: string;
  author_name: string;
  body: string;
  position: string;
  created_at: Date;
  updated_at: Date;
  topic_id: string | null;
} {
  return {
    id,
    column_id: columnId,
    author_id: facilitatorId,
    author_name: 'F',
    body: 'Card text',
    position: 'a0',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    topic_id: null,
  };
}

function fakeClient(opts: { suggestion?: { name: string; card_ids: string[] } | null; cardRows?: ReturnType<typeof cardRow>[] }) {
  const { suggestion = { name: 'Suggested group', card_ids: [cardAId, cardBId] }, cardRows = [cardRow(cardAId), cardRow(cardBId)] } = opts;
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: suggestion ? [suggestion] : [] }); // lookup suggestion
  if (suggestion) {
    query.mockResolvedValueOnce({ rows: cardRows }); // createTopicFromCardIds lookup
    query.mockResolvedValueOnce({ rows: [] }); // insert topics
    query.mockResolvedValueOnce({ rows: [] }); // update cards
    query.mockResolvedValueOnce({ rows: [] }); // update group_suggestions status
  }
  return { query } as unknown as PoolClient;
}

const payload = { suggestionId };

describe('suggestion.accept', () => {
  it('creates the group from the suggestion\'s stored name/cardIds and marks it accepted', async () => {
    const client = fakeClient({});
    const result = await suggestionAcceptMutation.apply({ client, retro: retroAt('group'), user: facilitator, payload });

    expect(result).toMatchObject({
      topic: { name: 'Suggested group', columnId },
      cards: [{ id: cardAId, topicId: expect.any(String) }, { id: cardBId, topicId: expect.any(String) }],
    });
    const statusUpdateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[4] as unknown[];
    expect(statusUpdateCall[0]).toContain("status = 'accepted'");
    expect(statusUpdateCall[1]).toEqual([suggestionId]);
  });

  it('rejects a non-facilitator', async () => {
    const client = fakeClient({});
    await expect(
      suggestionAcceptMutation.apply({ client, retro: retroAt('group'), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Group', async () => {
    for (const phase of ['review', 'write', 'vote', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = fakeClient({});
      await expect(
        suggestionAcceptMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });

  it('rejects an unknown or already-resolved suggestion', async () => {
    const client = fakeClient({ suggestion: null });
    await expect(
      suggestionAcceptMutation.apply({ client, retro: retroAt('group'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects (stale) if one of its cards was already grouped by hand in the meantime', async () => {
    const client = fakeClient({ cardRows: [{ ...cardRow(cardAId), topic_id: 'already-grouped' }, cardRow(cardBId)] });
    await expect(
      suggestionAcceptMutation.apply({ client, retro: retroAt('group'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 409, code: 'already_grouped' });
  });
});
