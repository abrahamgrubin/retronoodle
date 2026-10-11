import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { recordingRespondMutation } from './recordingRespond.js';

const userId = '00000000-0000-4000-8000-000000000004';
const user = { id: userId, email: 'p@example.com', displayName: 'Participant', avatarUrl: null };
const sessionId = '00000000-0000-4000-8000-000000000010';
const facilitatorId = '00000000-0000-4000-8000-000000000003';

function fakeClient(opts: {
  session?: { status: string; started_at: Date | null; stopped_at: Date | null } | null;
  myConsentOutcome?: string | null;
  remainingPending?: boolean;
  allConsents?: { user_id: string; outcome: string; responded_at: Date | null }[];
}) {
  const {
    session = { status: 'pending', started_at: null, stopped_at: null },
    myConsentOutcome = 'pending',
    remainingPending = false,
    allConsents = [],
  } = opts;
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('from recording_sessions where id')) {
      return Promise.resolve({
        rows: session
          ? [{ id: sessionId, started_by: facilitatorId, facilitator_confirmed_at: new Date('2026-01-01T00:00:00.000Z'), ...session }]
          : [],
      });
    }
    if (sql.includes('select outcome from recording_consents')) {
      return Promise.resolve({ rows: myConsentOutcome === null ? [] : [{ outcome: myConsentOutcome }] });
    }
    if (sql.includes("outcome <> 'agreed'")) {
      return Promise.resolve({ rows: remainingPending ? [{ x: 1 }] : [] });
    }
    if (sql.includes('select user_id, outcome, responded_at')) {
      return Promise.resolve({ rows: allConsents });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query } as unknown as PoolClient;
}

describe('recording.respond', () => {
  it('404s when the session does not exist', async () => {
    const client = fakeClient({ session: null });
    await expect(
      recordingRespondMutation.apply({ client, retro: undefined as never, user, payload: { sessionId, agree: true } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('409s when the session already stopped', async () => {
    const client = fakeClient({ session: { status: 'stopped', started_at: null, stopped_at: new Date() } });
    await expect(
      recordingRespondMutation.apply({ client, retro: undefined as never, user, payload: { sessionId, agree: true } }),
    ).rejects.toMatchObject({ status: 409, code: 'already_stopped' });
  });

  it('404s when the caller has no pending consent (already answered, or never asked)', async () => {
    const client = fakeClient({ myConsentOutcome: 'agreed' });
    await expect(
      recordingRespondMutation.apply({ client, retro: undefined as never, user, payload: { sessionId, agree: true } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('a decline stops the session outright', async () => {
    const client = fakeClient({ remainingPending: true, allConsents: [{ user_id: userId, outcome: 'declined', responded_at: new Date() }] });
    const result = await recordingRespondMutation.apply({ client, retro: undefined as never, user, payload: { sessionId, agree: false } });
    expect(result).toMatchObject({ session: { status: 'stopped', stoppedAt: expect.any(String) } });
  });

  it('an agree with other consents still pending leaves the session in its prior status', async () => {
    const client = fakeClient({
      session: { status: 'pending', started_at: null, stopped_at: null },
      remainingPending: true,
      allConsents: [{ user_id: userId, outcome: 'agreed', responded_at: new Date() }],
    });
    const result = await recordingRespondMutation.apply({ client, retro: undefined as never, user, payload: { sessionId, agree: true } });
    expect(result).toMatchObject({ session: { status: 'pending', startedAt: null } });
  });

  it('an agree that completes every consent flips the session to recording and sets startedAt', async () => {
    const client = fakeClient({
      session: { status: 'pending', started_at: null, stopped_at: null },
      remainingPending: false,
      allConsents: [{ user_id: userId, outcome: 'agreed', responded_at: new Date() }],
    });
    const result = await recordingRespondMutation.apply({ client, retro: undefined as never, user, payload: { sessionId, agree: true } });
    expect(result).toMatchObject({ session: { status: 'recording', startedAt: expect.any(String) } });
  });

  it('recovering from a pause (startedAt already set) keeps the original startedAt, not a new one', async () => {
    const originalStart = new Date('2026-01-01T00:10:00.000Z');
    const client = fakeClient({
      session: { status: 'paused', started_at: originalStart, stopped_at: null },
      remainingPending: false,
      allConsents: [{ user_id: userId, outcome: 'agreed', responded_at: new Date() }],
    });
    const result = await recordingRespondMutation.apply({ client, retro: undefined as never, user, payload: { sessionId, agree: true } });
    expect(result).toMatchObject({ session: { status: 'recording', startedAt: originalStart.toISOString() } });
  });
});
