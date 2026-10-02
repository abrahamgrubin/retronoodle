import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { cardDeleteMutation } from './cardDelete.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const cardId = '00000000-0000-4000-8000-000000000005';

function retroAt(phase: string): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: '00000000-0000-4000-8000-000000000003',
    phase,
    cards_revealed: true,
    phase_deadline: '2026-01-01T00:05:00.000Z',
    vote_budget: 3,
  };
}

function fakeClient(authorId: string | undefined, columnKind: 'standard' | 'action_items' = 'standard') {
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: authorId ? [{ author_id: authorId, column_kind: columnKind }] : [] }); // ownership + column-kind lookup
  if (authorId === user.id) {
    query.mockResolvedValueOnce({ rows: [] }); // delete
  }
  return { query } as unknown as PoolClient;
}

describe('card.delete', () => {
  it('lets the author delete their own card', async () => {
    const client = fakeClient(user.id);
    const result = await cardDeleteMutation.apply({ client, retro: retroAt('write'), user, payload: { cardId } });

    expect(result).toEqual({ id: cardId });
    const deleteCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(deleteCall[0]).toContain('delete from cards');
    expect(deleteCall[1]).toEqual([cardId]);
  });

  it('rejects a non-author', async () => {
    const client = fakeClient('someone-else');
    await expect(cardDeleteMutation.apply({ client, retro: retroAt('write'), user, payload: { cardId } })).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('rejects an unknown card', async () => {
    const client = fakeClient(undefined);
    await expect(cardDeleteMutation.apply({ client, retro: retroAt('write'), user, payload: { cardId } })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('phase gating (RN-010): a standard column follows cardCrud — write/group only', async () => {
    const client = fakeClient(user.id, 'standard');
    await expect(cardDeleteMutation.apply({ client, retro: retroAt('vote'), user, payload: { cardId } })).rejects.toMatchObject({
      status: 409,
      code: 'phase_not_allowed',
    });
  });

  it('phase gating (RN-010): the Action items column follows actionItemEdit — allowed in Wrap up, not Write', async () => {
    const duringWrapUp = fakeClient(user.id, 'action_items');
    await expect(cardDeleteMutation.apply({ client: duringWrapUp, retro: retroAt('wrap_up'), user, payload: { cardId } })).resolves.toEqual({
      id: cardId,
    });

    const duringWrite = fakeClient(user.id, 'action_items');
    await expect(cardDeleteMutation.apply({ client: duringWrite, retro: retroAt('write'), user, payload: { cardId } })).rejects.toMatchObject({
      status: 409,
      code: 'phase_not_allowed',
    });
  });
});
