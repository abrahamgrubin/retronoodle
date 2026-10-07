import { defineConfig } from '@playwright/test';

/** RN-011/RN-028: the acceptance criteria that need a real browser (hidden-card-text leaks, and
 * RN-028's full multi-phase walkthrough). Everything else in this repo's test pyramid is Vitest
 * (unit, integration against a live Supabase project) — this stays the only Playwright surface.
 *
 * Starts both the API and the web dev server itself (`reuseExistingServer` so it doesn't double
 * up with a `pnpm dev` already running locally) — CI must export SUPABASE_URL/SUPABASE_ANON_KEY/
 * SUPABASE_SERVICE_ROLE_KEY/DATABASE_URL/VITE_* first, the same env this job's other integration
 * tests already need.
 *
 * `workers: 1` in CI (found live: RN-028's full-retro-walkthrough spec — 4 browser contexts, a
 * long sequential chain of real HTTP/Realtime round trips — hit its own 30s timeout when CI ran
 * it concurrently with the other spec file's workers, under GitHub Actions' limited CPU; running
 * one worker at a time removes that contention instead of just padding the timeout further).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
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
