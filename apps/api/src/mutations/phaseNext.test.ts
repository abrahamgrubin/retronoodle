import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { phaseNextMutation } from './phaseNext.js';
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
    cards_revealed: false,
    phase_deadline: '2026-01-01T00:05:00.000Z',
  };
}

const newDeadline = new Date('2026-01-01T00:10:00.000Z');

function fakeClient() {
  // setPhase's own `update ... returning phase_deadline` needs a row back; every other query
  // here (onTransition's vote delete) ignores its return value, so one fixed shape covers both.
  const query = vi.fn().mockResolvedValue({ rows: [{ phase_deadline: newDeadline }] });
  return { query } as unknown as PoolClient;
}

describe('phase.next', () => {
  it('advances the facilitator through the canonical sequence, setting a fresh deadline', async () => {
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
      expect(result).toEqual({ phase: to, phaseDeadline: newDeadline.toISOString() });
      const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('set phase'));
      expect(updateCall?.[1]?.[0]).toBe(to);
      expect(updateCall?.[1]?.[2]).toBe(retroAt(from).id);
    }
  });

  it('write -> group also sets cards_revealed = true (RN-011: reveal on write -> group)', async () => {
    const client = fakeClient();
    await phaseNextMutation.apply({ client, retro: retroAt('write'), user: facilitator, payload: {} });
    const revealCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('cards_revealed'));
    expect(revealCall).toBeDefined();
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
