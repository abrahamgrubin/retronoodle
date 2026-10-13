import { test, expect } from '@playwright/test';
import {
  MISSING_SUPABASE_CREDENTIALS,
  SKIP_REASON,
  addTeamMember,
  cleanupTeam,
  createSignedInUser,
  createTeam,
  createRetro,
  getBoard,
  sendHeartbeat,
  sendMutation,
  signIn,
} from './helpers.js';

/**
 * RN-032, updated: "they already agreed to the discussion being recorded when they joined the
 * session" — recording now auto-starts the moment Discuss begins (onTransition.ts), not on a
 * facilitator's click. Every other consent mechanic (RN-032) is unchanged: online participants
 * still get "Allow recording?", a decline still stops it outright, a manual "Stop recording"
 * still exists. `phase.jumpTo` is what actually drives a fresh retro into Discuss here — direct
 * API calls, not clicking through every phase, since the consent flow is what these tests are
 * actually about.
 */
test.skip(MISSING_SUPABASE_CREDENTIALS, SKIP_REASON);

test('a participant must agree before recording starts, and stopping clears the badge on every browser', async ({ browser }) => {
  const facilitator = await createSignedInUser('recording-facilitator');
  const participant = await createSignedInUser('recording-participant');
  const teamId = await createTeam(facilitator, 'RN-032 e2e team');
  await addTeamMember(teamId, participant, 'Participant');
  const { retroId } = await createRetro(facilitator, teamId, 'RN-032 e2e retro');

  const facilitatorContext = await browser.newContext();
  const participantContext = await browser.newContext();
  const facilitatorPage = await facilitatorContext.newPage();
  const participantPage = await participantContext.newPage();

  try {
    await facilitatorPage.goto(`/retros/${retroId}`);
    await signIn(facilitatorPage, facilitator);
    await participantPage.goto(`/retros/${retroId}`);
    await signIn(participantPage, participant);

    // `signIn` only sets the session — it doesn't wait for the board to actually mount, which is
    // also when the participant's retro:{id} Realtime channel subscribes. Without this, there was
    // nothing stopping the phase jump below from broadcasting before the participant's own
    // channel had finished subscribing, which has no replay/catch-up (it's a plain broadcast, not
    // a queue) — a race that sometimes lost (found via CI flakiness).
    await expect(participantPage.getByText('RN-032 e2e retro')).toBeVisible();

    // The participant must be "online" (a recent heartbeat) before entering Discuss seeds their
    // consent — the real client does this on an interval; here, once is enough.
    await sendHeartbeat(retroId, participant.accessToken);

    // Drives the retro straight into Discuss — recording auto-starts as one of that jump's own
    // transition side effects (onTransition.ts), the same as a real walk through Write/Group/Vote
    // would, just without needing to drive every intermediate phase through the UI.
    await sendMutation(retroId, facilitator.accessToken, 'phase.jumpTo', { targetPhase: 'discuss' });

    // Not recording yet — the participant hasn't agreed.
    await expect(facilitatorPage.getByText('Recording', { exact: true })).toHaveCount(0);
    await expect(participantPage.getByText('Allow recording?')).toBeVisible();

    await participantPage.getByRole('button', { name: 'Allow' }).click();

    // Now both browsers see it, live — no reload on either side.
    await expect(facilitatorPage.getByText('Recording', { exact: true })).toBeVisible();
    await expect(participantPage.getByText('Recording', { exact: true })).toBeVisible();

    await facilitatorPage.getByRole('button', { name: 'Stop recording' }).click();

    await expect(facilitatorPage.getByText('Recording', { exact: true })).toHaveCount(0);
    await expect(participantPage.getByText('Recording', { exact: true })).toHaveCount(0);
  } finally {
    await facilitatorContext.close();
    await participantContext.close();
    await cleanupTeam(teamId, [facilitator, participant]);
  }
});

test('a decline stops the session for everyone', async ({ browser }) => {
  const facilitator = await createSignedInUser('recording-decline-facilitator');
  const participant = await createSignedInUser('recording-decline-participant');
  const teamId = await createTeam(facilitator, 'RN-032 e2e decline team');
  await addTeamMember(teamId, participant, 'Participant');
  const { retroId } = await createRetro(facilitator, teamId, 'RN-032 e2e decline retro');

  const facilitatorContext = await browser.newContext();
  const facilitatorPage = await facilitatorContext.newPage();

  try {
    await sendHeartbeat(retroId, participant.accessToken);
    await facilitatorPage.goto(`/retros/${retroId}`);
    await signIn(facilitatorPage, facilitator);

    // Same race as the other test in this file: `signIn` doesn't wait for the board to actually
    // mount and its retro:{id} channel to subscribe — without this, the jump below could
    // broadcast before the facilitator's own page was listening for it.
    await expect(facilitatorPage.getByText('RN-032 e2e decline retro')).toBeVisible();

    await sendMutation(retroId, facilitator.accessToken, 'phase.jumpTo', { targetPhase: 'discuss' });

    // The jump only fires the mutation; it doesn't wait for every one of its own side effects to
    // be visible here yet. "Stop recording" only ever renders once board.recordingSession is
    // populated, so waiting for it first means the session is guaranteed to exist by the time the
    // test fetches it below.
    await expect(facilitatorPage.getByRole('button', { name: 'Stop recording' })).toBeVisible();

    // Declining via the mutation directly (already covered interactively by the Allow path
    // above) — what matters here is the server-side effect: one decline stops it outright.
    const board = await getBoard(retroId, facilitator.accessToken);
    const sessionId = board.recordingSession.id as string;
    await sendMutation(retroId, participant.accessToken, 'recording.respond', { sessionId, agree: false });

    await expect(facilitatorPage.getByText('Recording', { exact: true })).toHaveCount(0);
    // Status flipped all the way to `stopped` — the manual "Stop recording" control (the only
    // recording-related button left) disappears along with it, same as after an explicit stop.
    await expect(facilitatorPage.getByRole('button', { name: 'Stop recording' })).toHaveCount(0);
  } finally {
    await facilitatorContext.close();
    await cleanupTeam(teamId, [facilitator, participant]);
  }
});
