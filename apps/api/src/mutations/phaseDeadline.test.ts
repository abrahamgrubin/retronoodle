import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { setPhase } from './phaseDeadline.js';

function fakeClient(returnedDeadline: Date | null) {
  const query = vi.fn().mockResolvedValue({ rows: [{ phase_deadline: returnedDeadline }] });
  return { query } as unknown as PoolClient;
}

describe('setPhase', () => {
  it('sets phase and passes the target phase\'s default minutes, returning the new deadline as ISO', async () => {
    const deadline = new Date('2026-01-01T00:05:00.000Z');
    const client = fakeClient(deadline);
    const result = await setPhase(client, 'retro-1', 'vote');

    expect(result).toBe(deadline.toISOString());
    const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(call[1]).toEqual(['vote', 3, 'retro-1']); // vote's default is 3 minutes
  });

  it('passes null minutes for a phase with no timer, and returns null', async () => {
    const client = fakeClient(null);
    const result = await setPhase(client, 'retro-1', 'closed');

    expect(result).toBeNull();
    const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(call[1]).toEqual(['closed', null, 'retro-1']);
  });
});
