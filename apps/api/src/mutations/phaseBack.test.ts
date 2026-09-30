import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { phaseBackMutation } from './phaseBack.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const retroId = '00000000-0000-4000-8000-000000000001';

function retroAt(phase: string): LockedRetro {
  return { id: retroId, team_id: '00000000-0000-4000-8000-000000000002', facilitator_id: facilitatorId, phase, cards_revealed: false };
}

function fakeClient() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { query } as unknown as PoolClient;
}

describe('phase.back', () => {
  it('group goes back to write', async () => {
    const client = fakeClient();
    const result = await phaseBackMutation.apply({ client, retro: retroAt('group'), user: facilitator, payload: {} });
    expect(result).toEqual({ phase: 'write' });
  });

  it('vote goes back to group and refunds all votes (deletes every vote row for the retro)', async () => {
    const client = fakeClient();
    const result = await phaseBackMutation.apply({ client, retro: retroAt('vote'), user: facilitator, payload: {} });
    expect(result).toEqual({ phase: 'group' });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    const deleteVotesCall = calls.find((c) => (c[0] as string).includes('delete from votes'));
    expect(deleteVotesCall?.[1]).toEqual([retroId]);
  });

  it('rejects going back from any phase other than group or vote', async () => {
    for (const phase of ['review', 'write', 'discuss', 'wrap_up', 'closed']) {
      const client = fakeClient();
      await expect(
        phaseBackMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload: {} }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });

  it('403s a non-facilitator', async () => {
    const client = fakeClient();
    await expect(
      phaseBackMutation.apply({ client, retro: retroAt('vote'), user: participant, payload: {} }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(client.query).not.toHaveBeenCalled();
  });
});
