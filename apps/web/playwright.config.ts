import { defineConfig } from '@playwright/test';

/** RN-011: the one acceptance criterion that needs a real browser — proving a non-author's
 * network traffic never carries another participant's hidden card text. Everything else in this
 * repo's test pyramid is Vitest (unit, integration against a live Supabase project); this is the
 * only Playwright spec, kept deliberately small.
 *
 * Starts both the API and the web dev server itself (`reuseExistingServer` so it doesn't double
 * up with a `pnpm dev` already running locally) — CI must export SUPABASE_URL/SUPABASE_ANON_KEY/
 * SUPABASE_SERVICE_ROLE_KEY/DATABASE_URL/VITE_* first, the same env this job's other integration
 * tests already need.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @retronoodle/api dev',
      cwd: '../..',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @retronoodle/web dev',
      cwd: '../..',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
