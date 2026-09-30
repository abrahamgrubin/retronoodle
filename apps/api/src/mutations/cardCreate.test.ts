import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { cardCreateMutation } from './cardCreate.js';
import type { LockedRetro } from './registry.js';

const retro: LockedRetro = {
  id: '00000000-0000-4000-8000-000000000001',
  team_id: '00000000-0000-4000-8000-000000000002',
  facilitator_id: '00000000-0000-4000-8000-000000000003',
  phase: 'write',
};
const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const columnId = '00000000-0000-4000-8000-000000000005';
const cardId = '00000000-0000-4000-8000-000000000006';

function fakeClient(columnExists: boolean, lastPosition: string | null) {
  const query = vi.fn();
  query.mockResolvedValueOnce({
    rows: [{ column_id: columnExists ? columnId : null, last_position: lastPosition }],
  }); // combined column-ownership + last-position lookup
  if (columnExists) {
    // pg's driver returns Date objects for timestamptz columns, not strings.
    query.mockResolvedValueOnce({ rows: [{ created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: new Date('2026-01-01T00:00:00.000Z') }] }); // insert
  }
  return { query } as unknown as PoolClient;
}

describe('card.create', () => {
  it('appends after the last card in the column when the column is non-empty', async () => {
    const client = fakeClient(true, 'a0');
    const result = await cardCreateMutation.apply({
      client,
      retro,
      user,
      payload: { cardId, columnId, body: 'Ship it' },
    });

    expect(result).toMatchObject({ id: cardId, columnId, authorId: user.id, body: 'Ship it' });
    expect((result as { position: string }).position > 'a0').toBe(true);

    const insertCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(insertCall[0]).toContain('insert into cards');
    expect(insertCall[1]).toEqual([cardId, retro.id, columnId, user.id, 'Ship it', (result as { position: string }).position]);
  });

  it('picks a starting position when the column is empty', async () => {
    const client = fakeClient(true, null);
    const result = await cardCreateMutation.apply({ client, retro, user, payload: { cardId, columnId, body: 'First card' } });
    expect(typeof (result as { position: string }).position).toBe('string');
  });

  it('rejects a column that does not belong to this retro', async () => {
    const client = fakeClient(false, null);
    await expect(
      cardCreateMutation.apply({ client, retro, user, payload: { cardId, columnId, body: 'Ship it' } }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_column' });
  });
});
