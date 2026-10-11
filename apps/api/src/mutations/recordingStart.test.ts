import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { recordingStartMutation } from './recordingStart.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const sessionId = '00000000-0000-4000-8000-000000000010';
const userA = '00000000-0000-4000-8000-000000000005';
const userB = '00000000-0000-4000-8000-000000000006';

function retroAt(phase = 'discuss'): LockedRetro {
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

function fakeClient(opts: { alreadyRecording?: boolean; facilitatorOnly?: boolean; onlineUserIds?: string[] }) {
  const { alreadyRecording = false, facilitatorOnly = false, onlineUserIds = [] } = opts;
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('from recording_sessions where retro_id')) {
      return Promise.resolve({ rows: alreadyRecording ? [{ x: 1 }] : [] });
    }
    if (sql.includes('from teams where id')) {
      return Promise.resolve({ rows: [{ recording_facilitator_only_confirmation: facilitatorOnly }] });
    }
    if (sql.includes('from retro_participants')) {
      return Promise.resolve({ rows: onlineUserIds.map((user_id) => ({ user_id })) });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query } as unknown as PoolClient;
}

const payload = { sessionId, confirmedExternalNotice: true as const };

describe('recording.start', () => {
  it('403s a non-facilitator', async () => {
    const client = fakeClient({});
    await expect(
      recordingStartMutation.apply({ client, retro: retroAt(), user: participant, payload }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('409s when a recording session is already active for this retro', async () => {
    const client = fakeClient({ alreadyRecording: true });
    await expect(
      recordingStartMutation.apply({ client, retro: retroAt(), user: facilitator, payload }),
    ).rejects.toMatchObject({ status: 409, code: 'already_recording' });
  });

  it('starts recording immediately under facilitator-only confirmation, seeding only the facilitator\'s own agreed consent', async () => {
    const client = fakeClient({ facilitatorOnly: true, onlineUserIds: [userA] });
    const result = await recordingStartMutation.apply({ client, retro: retroAt(), user: facilitator, payload });
    expect(result).toMatchObject({
      session: {
        status: 'recording',
        startedAt: expect.any(String),
        consents: [{ userId: facilitatorId, outcome: 'agreed' }],
      },
    });
    // Never even queries who's online under facilitator-only mode.
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('from retro_participants'), expect.anything());
  });

  it('starts recording immediately when nobody else is online (vacuously all-agreed)', async () => {
    const client = fakeClient({ onlineUserIds: [] });
    const result = await recordingStartMutation.apply({ client, retro: retroAt(), user: facilitator, payload });
    expect(result).toMatchObject({ session: { status: 'recording', consents: [{ userId: facilitatorId, outcome: 'agreed' }] } });
  });

  it('stays pending and seeds one consent row per online participant besides the facilitator', async () => {
    const client = fakeClient({ onlineUserIds: [userA, userB] });
    const result = await recordingStartMutation.apply({ client, retro: retroAt(), user: facilitator, payload });
    expect(result).toMatchObject({
      session: {
        status: 'pending',
        startedAt: null,
        consents: [
          { userId: facilitatorId, outcome: 'agreed' },
          { userId: userA, outcome: 'pending' },
          { userId: userB, outcome: 'pending' },
        ],
      },
    });
    const consentInserts = (client.query as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[0] as string).includes('insert into recording_consents'));
    expect(consentInserts).toHaveLength(3); // facilitator + userA + userB
  });
});
