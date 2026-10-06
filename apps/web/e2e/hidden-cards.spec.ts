import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  MISSING_SUPABASE_CREDENTIALS,
  SKIP_REASON,
  addTeamMember,
  cleanupTeam,
  createCard,
  createSignedInUser,
  setupRetro,
  signIn,
} from './helpers.js';

/**
 * RN-011 acceptance criterion: "Playwright: browser B's network traffic never contains browser
 * A's card text before reveal." Both users are created via the Supabase admin API and signed in
 * with a password (bypassing the real Google OAuth UI, which Playwright can't drive reliably),
 * then their session is injected into the page via `window.__supabase.auth.setSession()` — a
 * dev-only hook (see apps/web/src/supabaseClient.ts) that never ships in a production build.
 */

test.skip(MISSING_SUPABASE_CREDENTIALS, SKIP_REASON);

test("a non-author's network traffic never contains another participant's hidden card text", async ({ browser }) => {
  const author = await createSignedInUser('author');
  const other = await createSignedInUser('other');
  const { teamId, retroId, columnId } = await setupRetro(author, 'RN-011 e2e');
  await addTeamMember(teamId, other);

  const secretBeforeLoad = `SECRET-PRELOAD-${randomUUID()}`;
  await createCard(retroId, columnId, author, secretBeforeLoad);

  const context = await browser.newContext();
  const page = await context.newPage();

  const responseBodies: string[] = [];
  page.on('response', (res) => {
    // Matched on the *path*, not a substring of the full URL — Vite's dev server serves client
    // module source (e.g. `/src/boardReducer.ts`) at URLs that also contain "/board".
    if (new URL(res.url()).pathname.endsWith('/board')) {
      void res
        .text()
        .then((body) => responseBodies.push(body))
        .catch(() => {});
    }
  });
  const wsFrames: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') wsFrames.push(frame.payload);
    });
  });

  try {
    await page.goto(`/retros/${retroId}`);
    await signIn(page, other);
    await expect(page.getByRole('heading', { name: `RN-011 e2e retro ${retroId}` })).toBeVisible();
    await expect(page.getByText('Hidden until reveal').first()).toBeVisible();

    // A card created *after* "other" is already connected — proves the live broadcast path is
    // redacted too, not just the initial GET /board.
    const secretAfterLoad = `SECRET-LIVE-${randomUUID()}`;
    await createCard(retroId, columnId, author, secretAfterLoad);
    await expect(page.getByText('Hidden until reveal')).toHaveCount(2);

    for (const body of responseBodies) {
      expect(body).not.toContain(secretBeforeLoad);
      expect(body).not.toContain(secretAfterLoad);
    }
    for (const frame of wsFrames) {
      expect(frame).not.toContain(secretBeforeLoad);
      expect(frame).not.toContain(secretAfterLoad);
    }
    expect(responseBodies.length).toBeGreaterThan(0); // the assertions above weren't vacuous
    await expect(page.getByText(secretBeforeLoad)).toHaveCount(0);
    await expect(page.getByText(secretAfterLoad)).toHaveCount(0);
  } finally {
    await context.close();
    await cleanupTeam(teamId, [author, other]);
  }
});

test('the author sees full card text on a second tab that never created the card itself', async ({ browser }) => {
  const author = await createSignedInUser('author-two-tabs');
  const { teamId, retroId, columnId } = await setupRetro(author, 'RN-011 e2e');

  const secret = `SECRET-AUTHOR-${randomUUID()}`;
  await createCard(retroId, columnId, author, secret);

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`/retros/${retroId}`);
    await signIn(page, author);
    await expect(page.getByText(secret)).toBeVisible();
    await expect(page.getByText('Hidden until reveal')).toHaveCount(0); // never hidden from its own author
  } finally {
    await context.close();
    await cleanupTeam(teamId, [author]);
  }
});
