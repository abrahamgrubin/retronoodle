import { RecordingStopPayload, RecordingStopResult } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/** recording.stop (RN-032): facilitator-only, manual stop — the other way (besides a decline) a
 * session reaches `stopped`. A fresh "Record" click afterward starts a brand-new session row,
 * never reopens this one. */
export const recordingStopMutation: MutationTypeDef<RecordingStopPayload> = {
  schema: RecordingStopPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.manageRecording', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may stop recording');
    }

    // pg returns Date objects for timestamptz columns, not strings (same note as cardCreate.ts).
    const sessionResult = await client.query<{
      id: string;
      started_by: string;
      facilitator_confirmed_at: Date;
      started_at: Date | null;
      status: string;
    }>(`select id, started_by, facilitator_confirmed_at, started_at, status from recording_sessions where id = $1 and retro_id = $2 for update`, [
      payload.sessionId,
      retro.id,
    ]);
    const session = sessionResult.rows[0];
    if (!session) throw new MutationRejected(404, 'not_found', 'Recording session not found');
    if (session.status === 'stopped') throw new MutationRejected(409, 'already_stopped', 'This recording session already stopped');

    const now = new Date();
    await client.query(`update recording_sessions set status = 'stopped', stopped_at = $2 where id = $1`, [payload.sessionId, now.toISOString()]);

    const consentsResult = await client.query<{ user_id: string; outcome: string; responded_at: Date | null }>(
      `select user_id, outcome, responded_at from recording_consents where session_id = $1`,
      [payload.sessionId],
    );

    return RecordingStopResult.parse({
      session: {
        id: session.id,
        startedBy: session.started_by,
        facilitatorConfirmedAt: session.facilitator_confirmed_at.toISOString(),
        status: 'stopped',
        startedAt: session.started_at ? session.started_at.toISOString() : null,
        stoppedAt: now.toISOString(),
        consents: consentsResult.rows.map((r) => ({
          userId: r.user_id,
          outcome: r.outcome,
          respondedAt: r.responded_at ? r.responded_at.toISOString() : null,
        })),
      },
    });
  },
};
