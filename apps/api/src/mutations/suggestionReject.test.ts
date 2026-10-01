import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { suggestionRejectMutation } from './suggestionReject.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
const suggestionId = '00000000-0000-4000-8000-000000000010';

function retroAt(phase: string): LockedRetro {
  return { id: '00000000-0000-4000-8000-000000000001', team_id: '00000000-0000-4000-8000-000000000002', facilitator_id: facilitatorId, phase, cards_revealed: true, phase_deadline: null };
}

function fakeClient(resolved: boolean) {
  const query = vi.fn().mockResolvedValueOnce({ rows: resolved ? [{ id: suggestionId }] : [] });
  return { query } as unknown as PoolClient;
}

const payload = { suggestionId };

describe('suggestion.reject', () => {
  it('marks the suggestion rejected', async () => {
    const client = fakeClient(true);
    const result = await suggestionRejectMutation.apply({ client, retro: retroAt('group'), user: facilitator, payload });
    expect(result).toEqual({ suggestionId });
    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(updateCall[0]).toContain("status = 'rejected'");
    expect(updateCall[1]).toEqual([suggestionId, '00000000-0000-4000-8000-000000000001']);
  });

  it('rejects a non-facilitator', async () => {
    const client = fakeClient(true);
    await expect(
      suggestionRejectMutation.apply({ client, retro: retroAt('group'), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Group', async () => {
    for (const phase of ['review', 'write', 'vote', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = fakeClient(true);
      await expect(
        suggestionRejectMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });

  it('rejects an unknown or already-resolved suggestion', async () => {
    const client = fakeClient(false);
    await expect(
      suggestionRejectMutation.apply({ client, retro: retroAt('group'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});
