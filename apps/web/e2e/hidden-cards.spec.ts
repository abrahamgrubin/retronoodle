import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';

/**
 * RN-011 acceptance criterion: "Playwright: browser B's network traffic never contains browser
 * A's card text before reveal." Both users are created via the Supabase admin API and signed in
 * with a password (bypassing the real Google OAuth UI, which Playwright can't drive reliably),
 * then their session is injected into the page via `window.__supabase.auth.setSession()` — a
 * dev-only hook (see apps/web/src/supabaseClient.ts) that never ships in a production build.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_URL = process.env.VITE_API_URL ?? 'http://localhost:3000';

test.skip(
  !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY,
  'requires live Supabase credentials (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)',
);

const admin: SupabaseClient<Database> = createClient(SUPABASE_URL ?? 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY ?? 'x');

interface TestUser {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `rn011-e2e-${label}-${randomUUID()}@example.com`;
  const password = `Rn011-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);
  const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
  return { userId: data.user.id, accessToken: session.session.access_token, refreshToken: session.session.refresh_token };
}

/** Throws with the status and body on failure, instead of the caller getting an opaque
 * "Cannot read properties of undefined" three calls later — every setup step here must succeed. */
async function apiFetch(path: string, accessToken: string, body?: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res;
}

/** Creates a team (author is the only member at first), a retro (starts in Write), and returns
 * its first standard column's id — the shared fixture every test in this file builds on. */
async function setupRetro(author: TestUser) {
  // team_members.user_id FKs to profiles.id — GET /me is what upserts that row (same "new user"
  // gap RN-006 hit for /join/:code); skipping it makes POST /teams 500 on the FK violation.
  await apiFetch('/me', author.accessToken);

  const teamId = randomUUID();
  await apiFetch('/teams', author.accessToken, { id: teamId, name: `RN-011 e2e team ${teamId}` });

  const templatesRes = await apiFetch(`/teams/${teamId}/templates`, author.accessToken);
  const templateId = ((await templatesRes.json()) as { id: string }[])[0]!.id;

  const retroId = randomUUID();
  await apiFetch(`/teams/${teamId}/retros`, author.accessToken, { id: retroId, name: `RN-011 e2e retro ${retroId}`, templateId });

  const { data: column } = await admin.from('retro_columns').select('id').eq('retro_id', retroId).eq('kind', 'standard').limit(1).single();

  return { teamId, retroId, columnId: column!.id as string };
}

async function addTeamMember(teamId: string, user: TestUser) {
  await admin.from('profiles').insert({ id: user.userId, display_name: 'E2E participant', email: `${user.userId}@example.com` });
  await admin.from('team_members').insert({ team_id: teamId, user_id: user.userId, role: 'member' });
}

async function createCard(retroId: string, columnId: string, author: TestUser, body: string) {
  await apiFetch(`/retros/${retroId}/mutations`, author.accessToken, {
    mutationId: randomUUID(),
    type: 'card.create',
    payload: { cardId: randomUUID(), columnId, body },
  });
}

async function signIn(page: Page, user: TestUser) {
  await page.waitForFunction(() => Boolean((window as unknown as { __supabase?: unknown }).__supabase));
  await page.evaluate(async ({ accessToken, refreshToken }) => {
    const client = (window as unknown as { __supabase: { auth: { setSession(s: unknown): Promise<unknown> } } }).__supabase;
    await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  }, user);
}

async function cleanup(teamId: string, users: TestUser[]) {
  await admin.from('teams').delete().eq('id', teamId);
  for (const user of users) await admin.auth.admin.deleteUser(user.userId);
}

test("a non-author's network traffic never contains another participant's hidden card text", async ({ browser }) => {
  const author = await createSignedInUser('author');
  const other = await createSignedInUser('other');
  const { teamId, retroId, columnId } = await setupRetro(author);
  await addTeamMember(teamId, other);

  const secretBeforeLoad = `SECRET-PRELOAD-${randomUUID()}`;
  await createCard(retroId, columnId, author, secretBeforeLoad);

  const context = await browser.newContext();
  const page = await context.newPage();

  const responseBodies: string[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/board')) {
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
    await cleanup(teamId, [author, other]);
  }
});

test('the author sees full card text on a second tab that never created the card itself', async ({ browser }) => {
  const author = await createSignedInUser('author-two-tabs');
  const { teamId, retroId, columnId } = await setupRetro(author);

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
    await cleanup(teamId, [author]);
  }
});
