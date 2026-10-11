import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { recordingStopMutation } from './recordingStop.js';
import type { LockedRetro } from './registry.js';

const facilitatorId = '00000000-0000-4000-8000-000000000003';
const facilitator = { id: facilitatorId, email: 'f@example.com', displayName: 'Facilitator', avatarUrl: null };
const participant = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const sessionId = '00000000-0000-4000-8000-000000000010';

function retroAt(): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: facilitatorId,
    phase: 'discuss',
    cards_revealed: true,
    phase_deadline: null,
    vote_budget: 3,
  };
}

function fakeClient(opts: { session?: { status: string; started_at: Date | null } | null; consents?: { user_id: string; outcome: string; responded_at: Date | null }[] }) {
  const { session = { status: 'recording', started_at: new Date('2026-01-01T00:05:00.000Z') }, consents = [] } = opts;
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('from recording_sessions where id')) {
      return Promise.resolve({
        rows: session ? [{ id: sessionId, started_by: facilitatorId, facilitator_confirmed_at: new Date('2026-01-01T00:00:00.000Z'), ...session }] : [],
      });
    }
    if (sql.includes('select user_id, outcome, responded_at')) {
      return Promise.resolve({ rows: consents });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query } as unknown as PoolClient;
}

const payload = { sessionId };

describe('recording.stop', () => {
  it('403s a non-facilitator', async () => {
    const client = fakeClient({});
    await expect(recordingStopMutation.apply({ client, retro: retroAt(), user: participant, payload })).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('404s when the session does not exist', async () => {
    const client = fakeClient({ session: null });
    await expect(recordingStopMutation.apply({ client, retro: retroAt(), user: facilitator, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('409s when the session already stopped', async () => {
    const client = fakeClient({ session: { status: 'stopped', started_at: null } });
    await expect(recordingStopMutation.apply({ client, retro: retroAt(), user: facilitator, payload })).rejects.toMatchObject({
      status: 409,
      code: 'already_stopped',
    });
  });

  it('stops an active session, preserving its startedAt and returning every consent', async () => {
    const client = fakeClient({
      session: { status: 'recording', started_at: new Date('2026-01-01T00:05:00.000Z') },
      consents: [{ user_id: facilitatorId, outcome: 'agreed', responded_at: new Date('2026-01-01T00:00:00.000Z') }],
    });
    const result = await recordingStopMutation.apply({ client, retro: retroAt(), user: facilitator, payload });
    expect(result).toMatchObject({
      session: {
        status: 'stopped',
        startedAt: '2026-01-01T00:05:00.000Z',
        stoppedAt: expect.any(String),
        consents: [{ userId: facilitatorId, outcome: 'agreed' }],
      },
    });
  });
});
