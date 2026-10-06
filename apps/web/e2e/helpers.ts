import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';

/**
 * Shared scaffolding for this repo's Playwright specs (RN-011's hidden-cards.spec.ts and
 * RN-028's full-retro-walkthrough.spec.ts): creating real Supabase users, signing them in without
 * driving the real Google OAuth UI (which Playwright can't reliably automate), and the handful of
 * API calls every spec needs just to get a team/retro into existence before its own assertions
 * start.
 */

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const API_URL = process.env.VITE_API_URL ?? 'http://localhost:3000';

export const MISSING_SUPABASE_CREDENTIALS = !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY;
export const SKIP_REASON = 'requires live Supabase credentials (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)';

export const admin: SupabaseClient<Database> = createClient(SUPABASE_URL ?? 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY ?? 'x');

export interface TestUser {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `e2e-${label}-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);
  const anon = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !session.session) throw signInErr ?? new Error(`failed to sign in ${label}`);
  return { userId: data.user.id, accessToken: session.session.access_token, refreshToken: session.session.refresh_token };
}

/** Throws with the status and body on failure, instead of the caller getting an opaque
 * "Cannot read properties of undefined" three calls later — every setup step here must succeed. */
export async function apiFetch(path: string, accessToken: string, body?: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res;
}

export async function createTeam(author: TestUser, label: string): Promise<string> {
  // team_members.user_id FKs to profiles.id — GET /me is what upserts that row (same "new user"
  // gap RN-006 hit for /join/:code); skipping it makes POST /teams 500 on the FK violation.
  await apiFetch('/me', author.accessToken);
  const teamId = randomUUID();
  await apiFetch('/teams', author.accessToken, { id: teamId, name: `${label} ${teamId}` });
  return teamId;
}

/** Creates a retro for an already-existing team (whatever initial phase the server decides —
 * `write` for a team with no open action items, `review` once it has carried-over items) and
 * returns its first standard column's id, the fixture every spec builds its cards on. */
export async function createRetro(author: TestUser, teamId: string, label: string): Promise<{ retroId: string; columnId: string }> {
  const templatesRes = await apiFetch(`/teams/${teamId}/templates`, author.accessToken);
  const templateId = ((await templatesRes.json()) as { id: string }[])[0]!.id;

  const retroId = randomUUID();
  await apiFetch(`/teams/${teamId}/retros`, author.accessToken, { id: retroId, name: `${label} ${retroId}`, templateId });

  const { data: column } = await admin.from('retro_columns').select('id').eq('retro_id', retroId).eq('kind', 'standard').limit(1).single();

  return { retroId, columnId: column!.id as string };
}

/** The common case: a brand-new team (author is the only member) with one retro already in
 * Write. Most specs only need this one fixture. */
export async function setupRetro(author: TestUser, label: string) {
  const teamId = await createTeam(author, `${label} team`);
  const { retroId, columnId } = await createRetro(author, teamId, `${label} retro`);
  return { teamId, retroId, columnId };
}

export async function addTeamMember(teamId: string, user: TestUser, displayName = 'E2E participant') {
  await admin.from('profiles').insert({ id: user.userId, display_name: displayName, email: `${user.userId}@example.com` });
  await admin.from('team_members').insert({ team_id: teamId, user_id: user.userId, role: 'member' });
}

export async function createCard(retroId: string, columnId: string, author: TestUser, body: string) {
  await apiFetch(`/retros/${retroId}/mutations`, author.accessToken, {
    mutationId: randomUUID(),
    type: 'card.create',
    payload: { cardId: randomUUID(), columnId, body },
  });
}

/** `/retros/:id/mutations`, but returns the raw response instead of throwing — for the one case
 * (RN-028's F2 check) a spec needs to assert a mutation is *rejected*. */
export async function sendMutationRaw(retroId: string, accessToken: string, type: string, payload: unknown) {
  return fetch(`${API_URL}/retros/${retroId}/mutations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutationId: randomUUID(), type, payload }),
  });
}

export async function sendMutation(retroId: string, accessToken: string, type: string, payload: unknown) {
  const res = await sendMutationRaw(retroId, accessToken, type, payload);
  if (!res.ok) throw new Error(`${type} failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res;
}

export async function getBoard(retroId: string, accessToken: string) {
  const res = await apiFetch(`/retros/${retroId}/board`, accessToken);
  return res.json();
}

export async function signIn(page: Page, user: TestUser) {
  await page.waitForFunction(() => Boolean((window as unknown as { __supabase?: unknown }).__supabase));
  await page.evaluate(async ({ accessToken, refreshToken }) => {
    const client = (window as unknown as { __supabase: { auth: { setSession(s: unknown): Promise<unknown> } } }).__supabase;
    await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  }, user);
}

export async function cleanupTeam(teamId: string, users: TestUser[]) {
  await admin.from('teams').delete().eq('id', teamId);
  for (const user of users) await admin.auth.admin.deleteUser(user.userId);
}
