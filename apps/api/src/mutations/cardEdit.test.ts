import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { cardEditMutation } from './cardEdit.js';
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
    query.mockResolvedValueOnce({ rows: [] }); // update
  }
  return { query } as unknown as PoolClient;
}

describe('card.edit', () => {
  it('lets the author edit their own card', async () => {
    const client = fakeClient(user.id);
    const result = await cardEditMutation.apply({ client, retro, user, payload: { cardId, body: 'Updated' } });

    expect(result).toEqual({ id: cardId, body: 'Updated' });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[0]).toContain('update cards');
    expect(updateCall[1]).toEqual(['Updated', cardId]);
  });

  it('rejects a non-author', async () => {
    const client = fakeClient('someone-else');
    await expect(
      cardEditMutation.apply({ client, retro, user, payload: { cardId, body: 'Updated' } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects an unknown card', async () => {
    const client = fakeClient(undefined);
    await expect(
      cardEditMutation.apply({ client, retro, user, payload: { cardId, body: 'Updated' } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});
