import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { retroCloseMutation } from './retroClose.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };

function retroAt(phase: string): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: facilitatorId,
    phase,
    cards_revealed: true,
    phase_deadline: null,
    vote_budget: 3,
  };
}

const payload = { nextRetroAt: '2026-02-01', override: false };

function fakeClient(ownerlessRows: unknown[]) {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('set phase =')) return Promise.resolve({ rows: [{ phase_deadline: null }] });
    if (sql.includes('from action_items')) return Promise.resolve({ rows: ownerlessRows });
    return Promise.resolve({ rows: [] });
  });
  return { query } as unknown as PoolClient;
}

describe('retro.close', () => {
  it('closes when every action item is owned', async () => {
    const client = fakeClient([]);
    const result = await retroCloseMutation.apply({ client, retro: retroAt('wrap_up'), user: facilitator, payload });
    expect(result).toEqual({ phase: 'closed', phaseDeadline: null });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('next_retro_at'));
    expect(updateCall?.[1]).toEqual(['2026-02-01', false, retroAt('wrap_up').id]);
  });

  it('blocks closing when an active item has no owner, and never writes anything', async () => {
    const client = fakeClient([{ x: 1 }]);
    await expect(
      retroCloseMutation.apply({ client, retro: retroAt('wrap_up'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 409, code: 'owners_missing' });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('set phase ='), expect.anything());
  });

  it('override bypasses the check entirely, skipping the ownerless lookup', async () => {
    const client = fakeClient([{ x: 1 }]);
    const result = await retroCloseMutation.apply({
      client,
      retro: retroAt('wrap_up'),
      user: facilitator,
      payload: { ...payload, override: true },
    });
    expect(result).toEqual({ phase: 'closed', phaseDeadline: null });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('from action_items'), expect.anything());
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('next_retro_at'));
    expect(updateCall?.[1]).toEqual(['2026-02-01', true, retroAt('wrap_up').id]);
  });

  it('rejects outside Wrap up', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'discuss', 'setup', 'closed']) {
      const client = fakeClient([]);
      await expect(retroCloseMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload })).rejects.toMatchObject({
        status: 409,
        code: 'phase_not_allowed',
      });
    }
  });

  it('403s a non-facilitator', async () => {
    const client = fakeClient([]);
    await expect(
      retroCloseMutation.apply({ client, retro: retroAt('wrap_up'), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(client.query).not.toHaveBeenCalled();
  });
});
