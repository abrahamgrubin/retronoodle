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
 * RN-032: "every online participant sees 'Allow recording?'... Recording starts only when all
 * agree... Persistent red 'Recording' badge... a decline stops it." recording.start itself has
 * no phase gate, so this runs against a brand-new retro still in Write — no need to walk through
 * other phases just to exercise the consent flow.
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
  // window.confirm("I've told everyone outside the app...") — Playwright dismisses dialogs by
  // default, which would silently cancel the Record click.
  facilitatorPage.on('dialog', (dialog) => void dialog.accept());

  try {
    await facilitatorPage.goto(`/retros/${retroId}`);
    await signIn(facilitatorPage, facilitator);
    await participantPage.goto(`/retros/${retroId}`);
    await signIn(participantPage, participant);

    // The participant must be "online" (a recent heartbeat) before recording.start will seed
    // their consent — the real client does this on an interval; here, once is enough.
    await sendHeartbeat(retroId, participant.accessToken);

    await facilitatorPage.getByRole('button', { name: 'Record', exact: true }).click();

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
  facilitatorPage.on('dialog', (dialog) => void dialog.accept());

  try {
    await sendHeartbeat(retroId, participant.accessToken);
    await facilitatorPage.goto(`/retros/${retroId}`);
    await signIn(facilitatorPage, facilitator);
    await facilitatorPage.getByRole('button', { name: 'Record', exact: true }).click();

    // Declining via the mutation directly (already covered interactively by the Allow path
    // above) — what matters here is the server-side effect: one decline stops it outright.
    const board = await getBoard(retroId, facilitator.accessToken);
    const sessionId = board.recordingSession.id as string;
    await sendMutation(retroId, participant.accessToken, 'recording.respond', { sessionId, agree: false });

    await expect(facilitatorPage.getByText('Recording', { exact: true })).toHaveCount(0);
    // The Record button is offered again — status flipped all the way to `stopped`.
    await expect(facilitatorPage.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
  } finally {
    await facilitatorContext.close();
    await cleanupTeam(teamId, [facilitator, participant]);
  }
});
