import { RecordingRespondPayload, RecordingRespondResult } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * recording.respond (RN-032): "Allow recording?" answered — no facilitator-only gate here, the
 * caller's own `pending` consent row is the authorization (no row, or already answered, rejects
 * with 404 rather than 403; there's no role this is "forbidden" for, just nothing left to do).
 * A decline stops the session outright ("a decline keeps it off" — not just for the decliner, for
 * everyone, matching "all-party": one no means no recording). An agree flips the session to
 * `recording` the moment every seeded consent is `agreed`, whether this is the very first time
 * (pending -> recording) or recovering from a late joiner's pause (paused -> recording).
 */
export const recordingRespondMutation: MutationTypeDef<RecordingRespondPayload> = {
  schema: RecordingRespondPayload,
  async apply({ client, user, payload }) {
    // pg returns Date objects for timestamptz columns, not strings (same note as cardCreate.ts).
    const sessionResult = await client.query<{
      id: string;
      started_by: string;
      facilitator_confirmed_at: Date;
      status: string;
      started_at: Date | null;
      stopped_at: Date | null;
    }>(
      `select id, started_by, facilitator_confirmed_at, status, started_at, stopped_at
       from recording_sessions where id = $1 for update`,
      [payload.sessionId],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new MutationRejected(404, 'not_found', 'Recording session not found');
    if (session.status === 'stopped') throw new MutationRejected(409, 'already_stopped', 'This recording session already stopped');

    const consentResult = await client.query<{ outcome: string }>(
      `select outcome from recording_consents where session_id = $1 and user_id = $2 for update`,
      [payload.sessionId, user.id],
    );
    if (!consentResult.rows[0] || consentResult.rows[0].outcome !== 'pending') {
      throw new MutationRejected(404, 'not_found', 'No pending recording consent to respond to');
    }

    const now = new Date();
    const outcome = payload.agree ? 'agreed' : 'declined';
    await client.query(`update recording_consents set outcome = $1, responded_at = $2 where session_id = $3 and user_id = $4`, [
      outcome,
      now.toISOString(),
      payload.sessionId,
      user.id,
    ]);

    let status = session.status;
    let startedAt = session.started_at;
    let stoppedAt = session.stopped_at;

    if (!payload.agree) {
      status = 'stopped';
      stoppedAt = now;
    } else {
      const remaining = await client.query(
        `select 1 from recording_consents where session_id = $1 and outcome <> 'agreed' limit 1`,
        [payload.sessionId],
      );
      if (remaining.rows.length === 0) {
        status = 'recording';
        if (!startedAt) startedAt = now;
      }
    }

    await client.query(`update recording_sessions set status = $1, started_at = $2, stopped_at = $3 where id = $4`, [
      status,
      startedAt ? startedAt.toISOString() : null,
      stoppedAt ? stoppedAt.toISOString() : null,
      payload.sessionId,
    ]);

    const allConsents = await client.query<{ user_id: string; outcome: string; responded_at: Date | null }>(
      `select user_id, outcome, responded_at from recording_consents where session_id = $1`,
      [payload.sessionId],
    );

    return RecordingRespondResult.parse({
      session: {
        id: session.id,
        startedBy: session.started_by,
        facilitatorConfirmedAt: session.facilitator_confirmed_at.toISOString(),
        status,
        startedAt: startedAt ? startedAt.toISOString() : null,
        stoppedAt: stoppedAt ? stoppedAt.toISOString() : null,
        consents: allConsents.rows.map((r) => ({
          userId: r.user_id,
          outcome: r.outcome,
          respondedAt: r.responded_at ? r.responded_at.toISOString() : null,
        })),
      },
    });
  },
};
