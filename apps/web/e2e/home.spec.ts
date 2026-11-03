import { test, expect, type Page } from '@playwright/test';
import { MISSING_SUPABASE_CREDENTIALS, SKIP_REASON, admin, cleanupTeam, createSignedInUser, createTeam, signIn, type TestUser } from './helpers.js';

/**
 * RN-062 acceptance criteria that need a real browser: creating a retro from Home (through the
 * template radio group), creating a team as a user with no team, and signing out through the
 * account menu. Users are created through the Supabase admin API and signed in with the same
 * dev-only `window.__supabase` hook the other specs use (apps/web/src/supabaseClient.ts).
 */

test.skip(MISSING_SUPABASE_CREDENTIALS, SKIP_REASON);

/** The e2e users have no Google name, so the API's display name for them is their email, and
 * the greeting falls back to the local part of it (profileName.ts). */
function emailLocalPart(user: TestUser): string {
  return user.email.split('@')[0]!;
}

async function openHome(page: Page, user: TestUser) {
  await page.goto('/');
  await signIn(page, user);
  await expect(page.getByRole('heading', { level: 1, name: `Welcome ${emailLocalPart(user)}` })).toBeVisible();
}

test('creates a retro from Home through the template radio group', async ({ page }) => {
  const user = await createSignedInUser('home');
  const teamId = await createTeam(user, 'RN-062 e2e');

  try {
    await openHome(page, user);
    await expect(page.getByText('A little reflection. A better way forward.', { exact: false })).toBeVisible();

    const group = page.getByRole('radiogroup', { name: 'Template' });
    const cards = group.getByRole('radio');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(4);

    // Nothing is preselected, so the button is disabled even once a name is typed.
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);
    const createButton = page.getByRole('button', { name: 'Create a retro' });
    await expect(createButton).toBeDisabled();
    const nameField = page.getByLabel('Retro name');
    await expect(nameField).toHaveValue('');

    // Keyboard: Tab lands on the first card, arrows move and select, clicking the selected card
    // keeps it selected.
    await cards.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(cards.nth(1)).toBeFocused();
    await expect(cards.nth(1)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(cards.first()).toHaveAttribute('aria-checked', 'true');
    await cards.first().click();
    await expect(cards.first()).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);

    // Selected but blank name: still disabled. Then a name enables it.
    await expect(createButton).toBeDisabled();
    const retroName = `RN-062 e2e retro ${teamId}`;
    await nameField.fill(retroName);
    await expect(createButton).toBeEnabled();

    // The shortcut cards (scoped to their section — the sidebar has an "Action Items" link too)
    // link to the team's pages and sit in the Tab order.
    const shortcuts = page.getByRole('region', { name: 'Between retros' });
    const actionsShortcut = shortcuts.getByRole('link', { name: /Action Items/ });
    await expect(actionsShortcut).toHaveAttribute('href', `/teams/${teamId}/actions`);
    await expect(shortcuts.getByRole('link', { name: /Previous Retros/ })).toHaveAttribute('href', `/teams/${teamId}/retros`);
    await actionsShortcut.focus();
    await expect(actionsShortcut).toBeFocused();

    await createButton.click();
    await expect(page).toHaveURL(/\/retros\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: retroName })).toBeVisible();
  } finally {
    await cleanupTeam(teamId, [user]);
  }
});

test('a user with no team sees the sidebar and creates a team from Home', async ({ page }) => {
  const user = await createSignedInUser('noteam');

  try {
    await openHome(page, user);

    // Sidebar: Home and the account row only — no Retros/Action Items links without a team.
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Retros' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Action Items' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: user.email })).toBeVisible();

    await expect(page.getByRole('heading', { level: 2, name: 'Create a team' })).toBeVisible();
    await expect(page.getByText("You're not on a team yet. Create one to start running retros.")).toBeVisible();
    const createButton = page.getByRole('button', { name: 'Create a team' });
    await expect(createButton).toBeDisabled();
    await page.getByLabel('Team name').fill('RN-062 e2e no-team');
    await expect(createButton).toBeEnabled();
    await createButton.click();

    // Straight into the retro form for the new team, with the team links now in the sidebar.
    await expect(page.getByRole('heading', { level: 2, name: 'Create a retro' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Template' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Retros' })).toBeVisible();
  } finally {
    // The team id was generated in the browser, so find it by its creator.
    await admin.from('teams').delete().eq('created_by', user.userId);
    await admin.auth.admin.deleteUser(user.userId);
  }
});

test('signs out through the account menu', async ({ page }) => {
  const user = await createSignedInUser('signout');
  const teamId = await createTeam(user, 'RN-062 signout');

  try {
    await openHome(page, user);

    const accountButton = page.getByRole('button', { name: user.email });
    await accountButton.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();

    // Esc closes the menu without signing out.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: `Welcome ${emailLocalPart(user)}` })).toBeVisible();

    await accountButton.click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    // No confirmation: straight to the sign-in page at `/`, and it stays signed out on reload.
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  } finally {
    await cleanupTeam(teamId, [user]);
  }
});
