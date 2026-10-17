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
  it('overwrites additional_notes', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ additional_notes: 'Great retro overall.' }] });
    const client = { query } as unknown as PoolClient;
    const retro = retroAt('closed');

    const result = await recapEditNotesMutation.apply({ client, retro, user: facilitator, payload: { notes: 'Great retro overall.' } });

    expect(result).toEqual({ notes: 'Great retro overall.' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('update retro_recaps set additional_notes'), [
      'Great retro overall.',
      retro.id,
    ]);
  });

  it('allows saving back to an empty string', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ additional_notes: '' }] });
    const client = { query } as unknown as PoolClient;

    await expect(
      recapEditNotesMutation.apply({ client, retro: retroAt('closed'), user: facilitator, payload: { notes: '' } }),
    ).resolves.toEqual({ notes: '' });
  });

  it('rejects when no recap row exists yet', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as PoolClient;

    await expect(
      recapEditNotesMutation.apply({ client, retro: retroAt('closed'), user: facilitator, payload: { notes: 'x' } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      recapEditNotesMutation.apply({ client, retro: retroAt('closed'), user: participant, payload: { notes: 'x' } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Closed', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'discuss', 'wrap_up', 'setup']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        recapEditNotesMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload: { notes: 'x' } }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
