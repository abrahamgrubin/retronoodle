import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { topicAssignSpeakerMutation } from './topicAssignSpeaker.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000020';
const userId = '00000000-0000-4000-8000-000000000021';

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

function fakeClient(rows: { id: string }[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { query } as unknown as PoolClient;
}

const payload = { topicId, speakerTag: 1, userId };

describe('topic.assignSpeaker', () => {
  it('403s a non-facilitator', async () => {
    const client = fakeClient([]);
    await expect(
      topicAssignSpeakerMutation.apply({ client, retro: retroAt('discuss'), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('409s outside Discuss/Wrap up', async () => {
    const client = fakeClient([]);
    await expect(
      topicAssignSpeakerMutation.apply({ client, retro: retroAt('vote'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
  });

  it('404s when no segment matches that speaker tag in the topic', async () => {
    const client = fakeClient([]);
    await expect(
      topicAssignSpeakerMutation.apply({ client, retro: retroAt('discuss'), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('assigns every matching segment and returns their ids', async () => {
    const segmentId1 = '00000000-0000-4000-8000-000000000030';
    const segmentId2 = '00000000-0000-4000-8000-000000000031';
    const client = fakeClient([{ id: segmentId1 }, { id: segmentId2 }]);
    const result = await topicAssignSpeakerMutation.apply({ client, retro: retroAt('wrap_up'), user: facilitator, payload });
    expect(result).toEqual({ topicId, speakerTag: 1, userId, segmentIds: [segmentId1, segmentId2] });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('update transcript_segments'), [userId, topicId, 1, retroAt('wrap_up').id]);
  });
});
