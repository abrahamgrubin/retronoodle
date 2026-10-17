import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { recapEditDecisionsMutation } from './recapEditDecisions.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'F', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'P', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000010';
const outsideTopicId = '00000000-0000-4000-8000-000000000099';

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

const decisions = [{ topicId, topicName: 'Deploys', text: 'Switch runners.' }];

describe('recap.editDecisions', () => {
  it('overwrites the whole decisions array', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'row' }] }) // retro_recaps existence check
      .mockResolvedValueOnce({ rows: [{ id: topicId }] }) // known topics lookup
      .mockResolvedValueOnce({ rows: [] }); // update
    const client = { query } as unknown as PoolClient;
    const retro = retroAt('closed');

    const result = await recapEditDecisionsMutation.apply({ client, retro, user: facilitator, payload: { decisions } });

    expect(result).toEqual({ decisions });
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('update retro_recaps set decisions'), [
      JSON.stringify(decisions),
      retro.id,
    ]);
  });

  it('rejects a decision citing a topic outside this retro', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'row' }] })
      .mockResolvedValueOnce({ rows: [] }); // none of the cited topics belong to this retro
    const client = { query } as unknown as PoolClient;

    await expect(
      recapEditDecisionsMutation.apply({
        client,
        retro: retroAt('closed'),
        user: facilitator,
        payload: { decisions: [{ topicId: outsideTopicId, topicName: 'Elsewhere', text: 'Bogus.' }] },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_topic' });
  });

  it('rejects when no recap row exists yet', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as PoolClient;

    await expect(
      recapEditDecisionsMutation.apply({ client, retro: retroAt('closed'), user: facilitator, payload: { decisions: [] } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects a non-facilitator', async () => {
    const client = { query: vi.fn() } as unknown as PoolClient;
    await expect(
      recapEditDecisionsMutation.apply({ client, retro: retroAt('closed'), user: participant, payload: { decisions: [] } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('rejects outside Closed', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'discuss', 'wrap_up', 'setup']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        recapEditDecisionsMutation.apply({ client, retro: retroAt(phase), user: facilitator, payload: { decisions: [] } }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
