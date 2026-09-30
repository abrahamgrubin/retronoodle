import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { cardEditMutation } from './cardEdit.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const cardId = '00000000-0000-4000-8000-000000000005';

function retroAt(phase: string): LockedRetro {
  return { id: '00000000-0000-4000-8000-000000000001', team_id: '00000000-0000-4000-8000-000000000002', facilitator_id: '00000000-0000-4000-8000-000000000003', phase };
}

function fakeClient(authorId: string | undefined, columnKind: 'standard' | 'action_items' = 'standard') {
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: authorId ? [{ author_id: authorId, column_kind: columnKind }] : [] }); // ownership + column-kind lookup
  if (authorId === user.id) {
    query.mockResolvedValueOnce({ rows: [] }); // update
  }
  return { query } as unknown as PoolClient;
}

describe('card.edit', () => {
  it('lets the author edit their own card', async () => {
    const client = fakeClient(user.id);
    const result = await cardEditMutation.apply({ client, retro: retroAt('write'), user, payload: { cardId, body: 'Updated' } });

    expect(result).toEqual({ id: cardId, body: 'Updated' });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[0]).toContain('update cards');
    expect(updateCall[1]).toEqual(['Updated', cardId]);
  });

  it('rejects a non-author', async () => {
    const client = fakeClient('someone-else');
    await expect(
      cardEditMutation.apply({ client, retro: retroAt('write'), user, payload: { cardId, body: 'Updated' } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects an unknown card', async () => {
    const client = fakeClient(undefined);
    await expect(
      cardEditMutation.apply({ client, retro: retroAt('write'), user, payload: { cardId, body: 'Updated' } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('phase gating (RN-010): a standard column follows cardCrud — write/group only', async () => {
    const duringVote = fakeClient(user.id, 'standard');
    await expect(
      cardEditMutation.apply({ client: duringVote, retro: retroAt('vote'), user, payload: { cardId, body: 'Updated' } }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });

    const duringGroup = fakeClient(user.id, 'standard');
    await expect(
      cardEditMutation.apply({ client: duringGroup, retro: retroAt('group'), user, payload: { cardId, body: 'Updated' } }),
    ).resolves.toEqual({ id: cardId, body: 'Updated' });
  });

  it('phase gating (RN-010): the Action items column follows actionItemEdit — allowed in Discuss, not Write', async () => {
    const duringDiscuss = fakeClient(user.id, 'action_items');
    await expect(
      cardEditMutation.apply({ client: duringDiscuss, retro: retroAt('discuss'), user, payload: { cardId, body: 'Follow up, revised' } }),
    ).resolves.toEqual({ id: cardId, body: 'Follow up, revised' });

    const duringWrite = fakeClient(user.id, 'action_items');
    await expect(
      cardEditMutation.apply({ client: duringWrite, retro: retroAt('write'), user, payload: { cardId, body: 'Follow up, revised' } }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
  });
});
