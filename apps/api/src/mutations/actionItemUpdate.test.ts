import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { actionItemUpdateMutation } from './actionItemUpdate.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const actionItemId = '00000000-0000-4000-8000-000000000030';
const ownerId = '00000000-0000-4000-8000-000000000005';

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

function actionItemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: actionItemId,
    source_retro_id: '00000000-0000-4000-8000-000000000001',
    source_topic_id: null,
    title: 'Follow up with design',
    owner_id: ownerId,
    due_date: '2026-01-15',
    status: 'open',
    origin: 'manual',
    completed_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('actionItem.update', () => {
  it('updates only the fields the client sent — title only', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: actionItemId }] }); // existence check
    query.mockResolvedValueOnce({ rows: [actionItemRow({ title: 'Renamed' })] }); // update ... returning
    const client = { query } as unknown as PoolClient;

    const result = await actionItemUpdateMutation.apply({
      client,
      retro: retroAt('discuss'),
      user,
      payload: { id: actionItemId, title: 'Renamed' },
    });

    expect(result).toMatchObject({ actionItem: { title: 'Renamed' } });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    // title sent, owner/due date untouched (the two "is this field present" flags are false)
    expect(updateCall[1]).toEqual(['Renamed', false, null, false, null, actionItemId]);
  });

  it('updates owner and due date together, and can null out the owner', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: actionItemId }] });
    query.mockResolvedValueOnce({ rows: [actionItemRow({ owner_id: null, due_date: '2026-02-01' })] });
    const client = { query } as unknown as PoolClient;

    const result = await actionItemUpdateMutation.apply({
      client,
      retro: retroAt('wrap_up'),
      user,
      payload: { id: actionItemId, ownerId: null, dueDate: '2026-02-01' },
    });

    expect(result).toMatchObject({ actionItem: { ownerId: null, dueDate: '2026-02-01' } });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(updateCall[1]).toEqual([null, true, null, true, '2026-02-01', actionItemId]);
  });

  it('rejects an action item outside this retro (or unknown)', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;

    await expect(
      actionItemUpdateMutation.apply({ client, retro: retroAt('discuss'), user, payload: { id: actionItemId, title: 'x' } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects outside Review, Discuss and Wrap up', async () => {
    for (const phase of ['write', 'group', 'vote', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        actionItemUpdateMutation.apply({ client, retro: retroAt(phase), user, payload: { id: actionItemId, title: 'x' } }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
