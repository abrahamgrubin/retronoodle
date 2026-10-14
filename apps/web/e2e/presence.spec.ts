import { test, expect } from '@playwright/test';
import {
  MISSING_SUPABASE_CREDENTIALS,
  SKIP_REASON,
  addTeamMember,
  cleanupTeam,
  createSignedInUser,
  createTeam,
  createRetro,
  signIn,
} from './helpers.js';

/**
 * RN-044: "Joining and leaving update the avatar stack and count within 2s." Presence is purely
 * live/in-memory (no seq, nothing in BoardResponse to assert against via a plain GET) — the only
 * way to actually exercise it is two real browser contexts on the live Supabase Presence channel,
 * same reasoning as recording-consent.spec.ts's own two-context setup.
 */
test.skip(MISSING_SUPABASE_CREDENTIALS, SKIP_REASON);

test('the avatar stack and count update live as participants join and leave', async ({ browser }) => {
  const facilitator = await createSignedInUser('presence-facilitator');
  const participant = await createSignedInUser('presence-participant');
  const teamId = await createTeam(facilitator, 'RN-044 e2e team');
  await addTeamMember(teamId, participant, 'Participant');
  const { retroId } = await createRetro(facilitator, teamId, 'RN-044 e2e retro');

  const facilitatorContext = await browser.newContext();
  const facilitatorPage = await facilitatorContext.newPage();

  try {
    await facilitatorPage.goto(`/retros/${retroId}`);
    await signIn(facilitatorPage, facilitator);
    await expect(facilitatorPage.getByText('RN-044 e2e retro')).toBeVisible();

    // Alone so far — Presence has synced, but there's only the facilitator's own track() to show.
    await expect(facilitatorPage.getByText('1 person online')).toBeVisible();

    const participantContext = await browser.newContext();
    const participantPage = await participantContext.newPage();
    try {
      await participantPage.goto(`/retros/${retroId}`);
      await signIn(participantPage, participant);
      await expect(participantPage.getByText('RN-044 e2e retro')).toBeVisible();

      // Within 2s per the AC — Playwright's own default assertion timeout covers that already.
      await expect(facilitatorPage.getByText('2 people online')).toBeVisible();
    } finally {
      await participantContext.close();
    }

    // Presence detects the disconnect once the closed context's socket actually drops.
    await expect(facilitatorPage.getByText('1 person online')).toBeVisible();
  } finally {
    await facilitatorContext.close();
    await cleanupTeam(teamId, [facilitator, participant]);
  }
});
