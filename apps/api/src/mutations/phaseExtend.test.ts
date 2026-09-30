import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { phaseExtendMutation } from './phaseExtend.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const retroId = '00000000-0000-4000-8000-000000000001';

function retroAt(phaseDeadline: string | null): LockedRetro {
  return {
    id: retroId,
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: facilitatorId,
    phase: 'write',
    cards_revealed: false,
    phase_deadline: phaseDeadline,
  };
}

function fakeClient(returnedDeadline: Date) {
  const query = vi.fn().mockResolvedValue({ rows: [{ phase_deadline: returnedDeadline }] });
  return { query } as unknown as PoolClient;
}

describe('phase.extend', () => {
  it('lets the facilitator extend, adding the requested minutes', async () => {
    const extended = new Date('2026-01-01T00:07:00.000Z');
    const client = fakeClient(extended);
    const result = await phaseExtendMutation.apply({
      client,
      retro: retroAt('2026-01-01T00:05:00.000Z'),
      user: facilitator,
      payload: { minutes: 2 },
    });

    expect(result).toEqual({ phaseDeadline: extended.toISOString() });
    const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(call[0]).toContain('greatest(now(), phase_deadline)');
    expect(call[1]).toEqual([2, retroId]);
  });

  it('rejects a phase with no timer (phase_deadline null)', async () => {
    const client = fakeClient(new Date());
    await expect(
      phaseExtendMutation.apply({ client, retro: retroAt(null), user: facilitator, payload: { minutes: 1 } }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('403s a non-facilitator', async () => {
    const client = fakeClient(new Date());
    await expect(
      phaseExtendMutation.apply({ client, retro: retroAt('2026-01-01T00:05:00.000Z'), user: participant, payload: { minutes: 5 } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(client.query).not.toHaveBeenCalled();
  });
});
