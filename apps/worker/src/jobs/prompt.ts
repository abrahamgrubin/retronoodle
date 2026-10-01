import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loaded once per process, relative to this module's own file location (confirmed working in
 * both tsx's dev watch and vitest, which — unlike a hypothetical `process.cwd()`-relative path —
 * doesn't depend on which directory the process happened to be launched from; pnpm/turbo run
 * per-package scripts with that package's own directory as cwd, not the repo root, so a
 * cwd-relative path broke under `pnpm --filter @retronoodle/worker test` even though it would
 * have looked fine from the root).
 *
 * Known gap: apps/api's production build (`tsup ... --noExternal @retronoodle/worker`) bundles
 * this package's code into one dist/main.js file, which rewrites `import.meta.url` to that
 * output file's own location — this path will need to move with it (e.g. copying prompts/ next
 * to dist/, or switching to a build-time string import) whenever that build step is actually
 * fixed and exercised; it's currently broken for unrelated reasons (tsup's CLI flags changed)
 * and has never been run successfully, so there's nothing working to preserve yet.
 */
let cached: string | undefined;
export function loadGroupingPrompt(): string {
  if (!cached) cached = readFileSync(fileURLToPath(new URL('../../../../prompts/grouping/v1.md', import.meta.url)), 'utf-8');
  return cached;
}
