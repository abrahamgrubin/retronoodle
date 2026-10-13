import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { phaseJumpToMutation } from './phaseJumpTo.js';
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
    phase_deadline: null,
    vote_budget: 3,
  };
}

const newDeadline = new Date('2026-01-01T00:10:00.000Z');

function fakeClient() {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('set phase =')) return Promise.resolve({ rows: [{ phase_deadline: newDeadline }] });
    // autoStartRecordingIfNeeded's own check — short-circuited, same precedent as phaseNext.test.ts.
    if (sql.includes('from recording_sessions where retro_id')) return Promise.resolve({ rows: [{ exists: 1 }] });
    return Promise.resolve({ rows: [] });
  });
  return { query } as unknown as PoolClient;
}

describe('phase.jumpTo', () => {
  it('403s a non-facilitator', async () => {
    const client = fakeClient();
    await expect(
      phaseJumpToMutation.apply({ client, retro: retroAt('write'), user: participant, payload: { targetPhase: 'discuss' } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('409s jumping to the same phase', async () => {
    const client = fakeClient();
    await expect(
      phaseJumpToMutation.apply({ client, retro: retroAt('write'), user: facilitator, payload: { targetPhase: 'write' } }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
  });

  it('409s jumping to or from closed', async () => {
    const client = fakeClient();
    await expect(
      phaseJumpToMutation.apply({ client, retro: retroAt('closed'), user: facilitator, payload: { targetPhase: 'discuss' } }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    await expect(
      phaseJumpToMutation.apply({ client, retro: retroAt('wrap_up'), user: facilitator, payload: { targetPhase: 'closed' } }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
  });

  it('jumps forward across multiple phases, replaying each one’s own transition effect in order', async () => {
    const client = fakeClient();
    const result = await phaseJumpToMutation.apply({
      client,
      retro: retroAt('write'),
      user: facilitator,
      payload: { targetPhase: 'wrap_up' },
    });
    expect(result).toEqual({ phase: 'wrap_up', phaseDeadline: newDeadline.toISOString() });

    // write->group's own cards_revealed flip is one of the steps actually crossed.
    const revealCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('cards_revealed'));
    expect(revealCall).toBeDefined();
    // The final phase update lands on the real target, not an intermediate one.
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('set phase ='));
    expect(updateCall?.[1]?.[0]).toBe('wrap_up');
  });

  it('jumps backward across multiple phases', async () => {
    const client = fakeClient();
    const result = await phaseJumpToMutation.apply({
      client,
      retro: retroAt('wrap_up'),
      user: facilitator,
      payload: { targetPhase: 'write' },
    });
    expect(result).toEqual({ phase: 'write', phaseDeadline: newDeadline.toISOString() });
    // Crossing vote->group backward refunds votes — one of the steps actually crossed going back.
    const refundCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('delete from votes'));
    expect(refundCall).toBeDefined();
  });

  it('jumps exactly one step the same way phase.next/back do', async () => {
    const client = fakeClient();
    const result = await phaseJumpToMutation.apply({
      client,
      retro: retroAt('review'),
      user: facilitator,
      payload: { targetPhase: 'write' },
    });
    expect(result).toEqual({ phase: 'write', phaseDeadline: newDeadline.toISOString() });
  });
});
