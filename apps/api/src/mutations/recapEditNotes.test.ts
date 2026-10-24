import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { recapEditNotesMutation } from './recapEditNotes.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };

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

describe('recap.editNotes', () => {
  it('upserts additional_notes in Wrap up and once closed', async () => {
    for (const phase of ['wrap_up', 'closed']) {
      const query = vi.fn().mockResolvedValue({ rows: [{ additional_notes: 'Follow up with design.' }] });
      const client = { query } as unknown as PoolClient;
      const retro = retroAt(phase);

      const result = await recapEditNotesMutation.apply({ client, retro, user: facilitator, payload: { notes: 'Follow up with design.' } });

      expect(result).toEqual({ notes: 'Follow up with design.' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('on conflict (retro_id) do update set additional_notes'), [
        retro.id,
        'Follow up with design.',
      ]);
    }
  });

  it('allows saving back to an empty string', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ additional_notes: '' }] });
    const client = { query } as unknown as PoolClient;

    await expect(
      recapEditNotesMutation.apply({ client, retro: retroAt('closed'), user: facilitator, payload: { notes: '' } }),
    ).resolves.toEqual({ notes: '' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      recapEditNotesMutation.apply({ client, retro: retroAt('closed'), user: participant, payload: { notes: 'x' } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Wrap up and Closed', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'discuss', 'setup']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        recapEditNotesMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload: { notes: 'x' } }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
