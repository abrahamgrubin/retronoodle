import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { phaseNextMutation } from './phaseNext.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };

function retroAt(phase: string): LockedRetro {
  return { id: '00000000-0000-4000-8000-000000000001', team_id: '00000000-0000-4000-8000-000000000002', facilitator_id: facilitatorId, phase };
}

function fakeClient() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { query } as unknown as PoolClient;
}

describe('phase.next', () => {
  it('advances the facilitator through the canonical sequence', async () => {
    const cases: Array<[string, string]> = [
      ['review', 'write'],
      ['write', 'group'],
      ['group', 'vote'],
      ['vote', 'discuss'],
      ['discuss', 'wrap_up'],
      ['wrap_up', 'closed'],
    ];
    for (const [from, to] of cases) {
      const client = fakeClient();
      const result = await phaseNextMutation.apply({ client, retro: retroAt(from), user: facilitator, payload: {} });
      expect(result).toEqual({ phase: to });
      const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('update retros'));
      expect(updateCall?.[1]).toEqual([to, retroAt(from).id]);
    }
  });

  it('rejects advancing from closed — nothing left to advance to', async () => {
    const client = fakeClient();
    await expect(
      phaseNextMutation.apply({ client, retro: retroAt('closed'), user: facilitator, payload: {} }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
  });

  it('403s a non-facilitator, even a team admin', async () => {
    const client = fakeClient();
    await expect(
      phaseNextMutation.apply({ client, retro: retroAt('write'), user: participant, payload: {} }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(client.query).not.toHaveBeenCalled();
  });
});
