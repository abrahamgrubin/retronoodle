import { z } from 'zod';

/** RN-032. `pending` -> `recording` once every online participant's consent is `agreed`;
 * `paused` is specifically "a late joiner hasn't agreed yet" (recording was already going);
 * `stopped` is terminal — a decline, or the facilitator manually stopping it, always ends in
 * `stopped`, never back to `pending` (a fresh "Record" click starts a brand-new session row). */
export const RecordingSessionStatus = z.enum(['pending', 'recording', 'paused', 'stopped']);
export type RecordingSessionStatus = z.infer<typeof RecordingSessionStatus>;

export const RecordingConsentOutcome = z.enum(['pending', 'agreed', 'declined']);
export type RecordingConsentOutcome = z.infer<typeof RecordingConsentOutcome>;

/** One participant's consent (or the facilitator's own, auto-`agreed` at creation — starting the
 * session already is their agreement, logged separately via `facilitatorConfirmedAt` below). */
export const RecordingConsent = z.object({
  userId: z.string().uuid(),
  outcome: RecordingConsentOutcome,
  respondedAt: z.string().nullable(),
});
export type RecordingConsent = z.infer<typeof RecordingConsent>;

/** The retro's current recording session — `null` when none exists yet, or the last one has
 * `stopped`. `facilitatorConfirmedAt` is "the facilitator confirmed they've told everyone outside
 * the app," logged with time per this story's own AC — distinct from any participant's own
 * consent in `consents`. */
export const RecordingSession = z.object({
  id: z.string().uuid(),
  startedBy: z.string().uuid(),
  facilitatorConfirmedAt: z.string(),
  status: RecordingSessionStatus,
  startedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  consents: z.array(RecordingConsent),
});
export type RecordingSession = z.infer<typeof RecordingSession>;
