import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { cardMoveMutation } from './cardMove.js';
import type { LockedRetro } from './registry.js';

const authorId = '00000000-0000-4000-8000-000000000004';
const otherUserId = '00000000-0000-4000-8000-000000000005';
const author = { id: authorId, email: 'a@example.com', displayName: 'A', avatarUrl: null };
const otherUser = { id: otherUserId, email: 'b@example.com', displayName: 'B', avatarUrl: null };
const cardId = '00000000-0000-4000-8000-000000000006';
const targetColumnId = '00000000-0000-4000-8000-000000000007';

function retroAt(phase: string): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: '00000000-0000-4000-8000-000000000003',
    phase,
    cards_revealed: true,
    phase_deadline: null,
  };
}

const remainingMember = {
  id: '00000000-0000-4000-8000-000000000008',
  column_id: targetColumnId,
  author_id: authorId,
  author_name: 'A',
  body: 'Still here',
  position: 'a0',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

function fakeClient(opts: {
  cardExists?: boolean;
  targetColumnKind?: 'standard' | 'action_items' | null;
  authorId?: string;
  topicId?: string | null;
  /** How many cards dissolveIfOrphaned's "who's left" query (topicHelpers.ts) finds once this
   * card has already left `topicId` — only meaningful when `topicId` is set. */
  othersLeftInTopic?: 0 | 1 | 2;
}) {
  const { cardExists = true, targetColumnKind = 'standard', authorId: cardAuthorId = authorId, topicId = null, othersLeftInTopic = 1 } =
    opts;
  const query = vi.fn();
  query.mockResolvedValueOnce({
    rows: cardExists
      ? [
          {
            author_id: cardAuthorId,
            author_name: 'A',
            body: 'Ship it',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            topic_id: topicId,
            target_column_kind: targetColumnKind,
          },
        ]
      : [],
  });
  query.mockResolvedValueOnce({ rows: [{ updated_at: new Date('2026-01-02T00:00:00.000Z') }] }); // update
  if (topicId) {
    // dissolveIfOrphaned's "who's left" query, then — only for 0 or 1 remaining — its delete.
    const rows = othersLeftInTopic === 2 ? [remainingMember, remainingMember] : othersLeftInTopic === 1 ? [remainingMember] : [];
    query.mockResolvedValueOnce({ rows });
    if (othersLeftInTopic !== 2) query.mockResolvedValueOnce({ rows: [] }); // delete from topics
  }
  return { query } as unknown as PoolClient;
}

const payload = { cardId, columnId: targetColumnId, position: 'a5' };

describe('card.move', () => {
  it('lets the author move their own card during Write', async () => {
    const client = fakeClient({});
    const result = await cardMoveMutation.apply({ client, retro: retroAt('write'), user: author, payload });

    expect(result).toEqual({
      card: {
        id: cardId,
        columnId: targetColumnId,
        authorId,
        authorName: 'A',
        body: 'Ship it',
        position: 'a5',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        topicId: null,
        reactions: [],
        hidden: false,
      },
      dissolvedTopic: null,
    });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[0]).toContain('update cards');
    expect(updateCall[1]).toEqual([targetColumnId, 'a5', cardId]);
  });

  it('clears topic_id on move, and leaves a 3+ member group untouched (RN-015)', async () => {
    const topicId = '00000000-0000-4000-8000-000000000020';
    const client = fakeClient({ topicId, othersLeftInTopic: 2 });
    const result = await cardMoveMutation.apply({ client, retro: retroAt('write'), user: author, payload });

    expect(result).toMatchObject({ card: { topicId: null }, dissolvedTopic: null });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[1]).toEqual([targetColumnId, 'a5', cardId]);
  });

  it('dissolves a group left with exactly one card ("a one-card group dissolves")', async () => {
    const topicId = '00000000-0000-4000-8000-000000000020';
    const client = fakeClient({ topicId, othersLeftInTopic: 1 });
    const result = await cardMoveMutation.apply({ client, retro: retroAt('write'), user: author, payload });

    expect(result).toMatchObject({
      dissolvedTopic: { topicId, remainingCard: { id: remainingMember.id, topicId: null, hidden: false } },
    });
    const deleteCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[3] as unknown[];
    expect(deleteCall[0]).toContain('delete from topics');
    expect(deleteCall[1]).toEqual([topicId]);
  });

  it('dissolves (and cleans up) a group left with zero other cards', async () => {
    const topicId = '00000000-0000-4000-8000-000000000020';
    const client = fakeClient({ topicId, othersLeftInTopic: 0 });
    const result = await cardMoveMutation.apply({ client, retro: retroAt('write'), user: author, payload });

    expect(result).toMatchObject({ dissolvedTopic: null });
    const deleteCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[3] as unknown[];
    expect(deleteCall[0]).toContain('delete from topics');
  });

  it('rejects a non-author moving a card during Write ("own" scope)', async () => {
    const client = fakeClient({});
    await expect(
      cardMoveMutation.apply({ client, retro: retroAt('write'), user: otherUser, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('lets anyone move anyone\'s card during Group ("all" scope)', async () => {
    const client = fakeClient({});
    const result = await cardMoveMutation.apply({ client, retro: retroAt('group'), user: otherUser, payload });
    expect(result).toMatchObject({ card: { id: cardId, columnId: targetColumnId } });
  });

  it('rejects card.move outside Write/Group', async () => {
    for (const phase of ['review', 'vote', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = fakeClient({});
      await expect(
        cardMoveMutation.apply({ client, retro: retroAt(phase), user: author, payload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });

  it('rejects an unknown card', async () => {
    const client = fakeClient({ cardExists: false });
    await expect(
      cardMoveMutation.apply({ client, retro: retroAt('write'), user: author, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a target column that does not belong to this retro', async () => {
    const client = fakeClient({ targetColumnKind: null });
    await expect(
      cardMoveMutation.apply({ client, retro: retroAt('write'), user: author, payload }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_column' });
  });

  it('rejects dragging a card into the Action items column', async () => {
    const client = fakeClient({ targetColumnKind: 'action_items' });
    await expect(
      cardMoveMutation.apply({ client, retro: retroAt('group'), user: author, payload }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_column' });
  });
});
