import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { cardsRevealMutation } from './cardsReveal.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const cardAuthorId = '00000000-0000-4000-8000-000000000005';

function retroAt(phase: string): LockedRetro {
  return { id: '00000000-0000-4000-8000-000000000001', team_id: '00000000-0000-4000-8000-000000000002', facilitator_id: facilitatorId, phase, cards_revealed: false, phase_deadline: '2026-01-01T00:05:00.000Z', vote_budget: 3 };
}

function fakeClient() {
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: [] }); // update retros set cards_revealed = true
  query.mockResolvedValueOnce({
    rows: [
      {
        id: '00000000-0000-4000-8000-000000000006',
        column_id: '00000000-0000-4000-8000-000000000007',
        author_id: cardAuthorId,
        author_name: 'Ada',
        body: 'Hidden thought',
        position: 'a0',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
        topic_id: null,
      },
    ],
  }); // fetchFullBoardCards
  return { query } as unknown as PoolClient;
}

describe('cards.reveal', () => {
  it('lets the facilitator reveal, returning every card in full', async () => {
    const client = fakeClient();
    const result = await cardsRevealMutation.apply({ client, retro: retroAt('write'), user: facilitator, payload: {} });

    expect(result).toEqual({
      cards: [
        {
          id: '00000000-0000-4000-8000-000000000006',
          columnId: '00000000-0000-4000-8000-000000000007',
          authorId: cardAuthorId,
          authorName: 'Ada',
          body: 'Hidden thought',
          position: 'a0',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          topicId: null,
          reactions: [],
          hidden: false,
        },
      ],
    });

    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(updateCall[0]).toContain('cards_revealed = true');
  });

  it('403s a non-facilitator', async () => {
    const client = fakeClient();
    await expect(
      cardsRevealMutation.apply({ client, retro: retroAt('write'), user: participant, payload: {} }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rejects outside Write', async () => {
    const client = fakeClient();
    await expect(
      cardsRevealMutation.apply({ client, retro: retroAt('group'), user: facilitator, payload: {} }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
  });
});
