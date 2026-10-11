import { RecordingStartPayload, RecordingStartResult, type RecordingSession } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import { ONLINE_WINDOW_SECONDS } from '../recordingSession.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * recording.start (RN-032): facilitator-only — "Facilitator clicks Record → confirms 'I've told
 * everyone outside the app'" (`confirmedExternalNotice`, logged here as
 * `facilitator_confirmed_at`). Seeds one `recording_consents` row per currently-online
 * participant (`retro_participants.last_seen_at` within `ONLINE_WINDOW_SECONDS`) besides the
 * facilitator, whose own row is seeded `agreed` immediately — starting the session and
 * confirming already is their agreement. If the team's `recording_facilitator_only_confirmation`
 * setting is on, or nobody else is online right now, the session starts `recording` immediately
 * (vacuously "everyone online has agreed"); otherwise it stays `pending` until every seeded
 * consent flips to `agreed` (recordingRespond.ts).
 */
export const recordingStartMutation: MutationTypeDef<RecordingStartPayload> = {
  schema: RecordingStartPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.manageRecording', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may start recording');
    }

    const existing = await client.query(`select 1 from recording_sessions where retro_id = $1 and status <> 'stopped' limit 1`, [
      retro.id,
    ]);
    if (existing.rows.length > 0) {
      throw new MutationRejected(409, 'already_recording', 'A recording session is already active for this retro');
    }

    const teamResult = await client.query<{ recording_facilitator_only_confirmation: boolean }>(
      `select recording_facilitator_only_confirmation from teams where id = $1`,
      [retro.team_id],
    );
    const facilitatorOnly = teamResult.rows[0]?.recording_facilitator_only_confirmation ?? false;

    const onlineResult = facilitatorOnly
      ? { rows: [] as { user_id: string }[] }
      : await client.query<{ user_id: string }>(
          `select user_id from retro_participants
           where retro_id = $1 and user_id <> $2 and last_seen_at > now() - make_interval(secs => $3)`,
          [retro.id, user.id, ONLINE_WINDOW_SECONDS],
        );

    const allAgreedAlready = facilitatorOnly || onlineResult.rows.length === 0;
    const now = new Date();

    await client.query(
      `insert into recording_sessions (id, retro_id, started_by, facilitator_confirmed_at, status, started_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        payload.sessionId,
        retro.id,
        user.id,
        now.toISOString(),
        allAgreedAlready ? 'recording' : 'pending',
        allAgreedAlready ? now.toISOString() : null,
      ],
    );
    await client.query(`insert into recording_consents (session_id, user_id, outcome, responded_at) values ($1, $2, 'agreed', $3)`, [
      payload.sessionId,
      user.id,
      now.toISOString(),
    ]);

    const consents: RecordingSession['consents'] = [{ userId: user.id, outcome: 'agreed', respondedAt: now.toISOString() }];
    for (const row of onlineResult.rows) {
      await client.query(`insert into recording_consents (session_id, user_id) values ($1, $2)`, [payload.sessionId, row.user_id]);
      consents.push({ userId: row.user_id, outcome: 'pending', respondedAt: null });
    }

    return RecordingStartResult.parse({
      session: {
        id: payload.sessionId,
        startedBy: user.id,
        facilitatorConfirmedAt: now.toISOString(),
        status: allAgreedAlready ? 'recording' : 'pending',
        startedAt: allAgreedAlready ? now.toISOString() : null,
        stoppedAt: null,
        consents,
      },
    });
  },
};
