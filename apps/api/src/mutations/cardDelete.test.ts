import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { cardDeleteMutation } from './cardDelete.js';
import type { LockedRetro } from './registry.js';

const retro: LockedRetro = {
  id: '00000000-0000-4000-8000-000000000001',
  team_id: '00000000-0000-4000-8000-000000000002',
  facilitator_id: '00000000-0000-4000-8000-000000000003',
  phase: 'write',
};
const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const cardId = '00000000-0000-4000-8000-000000000005';

function fakeClient(authorId: string | undefined) {
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: authorId ? [{ author_id: authorId }] : [] }); // ownership lookup
  if (authorId === user.id) {
    query.mockResolvedValueOnce({ rows: [] }); // delete
  }
  return { query } as unknown as PoolClient;
}

describe('card.delete', () => {
  it('lets the author delete their own card', async () => {
    const client = fakeClient(user.id);
    const result = await cardDeleteMutation.apply({ client, retro, user, payload: { cardId } });

    expect(result).toEqual({ id: cardId });
    const deleteCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(deleteCall[0]).toContain('delete from cards');
    expect(deleteCall[1]).toEqual([cardId]);
  });

  it('rejects a non-author', async () => {
    const client = fakeClient('someone-else');
    await expect(cardDeleteMutation.apply({ client, retro, user, payload: { cardId } })).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('rejects an unknown card', async () => {
    const client = fakeClient(undefined);
    await expect(cardDeleteMutation.apply({ client, retro, user, payload: { cardId } })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});
