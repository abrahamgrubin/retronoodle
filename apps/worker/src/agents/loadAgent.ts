import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AgentDefinition {
  name: string;
  description: string;
  /** Informational only — see .claude/agents/README.md. The model a job actually calls with
   * comes from packages/shared/src/ai.ts, never from this field. */
  model: string;
  /** The prompt itself — everything after the closing `---`, trimmed. May contain
   * `{{PLACEHOLDER}}` tokens the caller substitutes before sending it to Anthropic. */
  body: string;
  /** RN-021: a short hash of `body`, for jobs that persist which exact prompt produced a stored
   * result (`topic_summaries.prompt_version`). Automatic, not a hand-maintained version number —
   * editing the prompt file changes this the moment the process next loads it, so a stale
   * version can never be left unbumped by mistake. Not informational like `model` above: this one
   * actually gets written to the database. */
  promptVersion: string;
}

/** Exported for its own unit tests — the parsing logic doesn't need a real file on disk to
 * verify, only `loadAgent` itself (the integration with the real .claude/agents/ directory)
 * does. Split line-by-line rather than with one regex — a regex sandwiching the frontmatter
 * between two `\n---` literals can't actually match *zero* frontmatter lines (the two markers
 * would only be one `\n` apart, not two), which a single "does this look like frontmatter at
 * all" regex gets subtly wrong instead of just not matching. */
export function parseAgentFile(raw: string, name: string): AgentDefinition {
  const lines = raw.split('\n');
  const closingIndex = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (closingIndex === -1) throw new Error(`.claude/agents/${name}.md is missing its --- frontmatter block`);

  const fields = new Map<string, string>();
  for (const line of lines.slice(1, closingIndex)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }

  const body = lines.slice(closingIndex + 1).join('\n').trim();

  return {
    name: fields.get('name') ?? name,
    description: fields.get('description') ?? '',
    model: fields.get('model') ?? '',
    body,
    promptVersion: createHash('sha256').update(body).digest('hex').slice(0, 12),
  };
}

/**
 * Walks up from `startDir` until it finds a directory containing `.claude/agents` — a fixed
 * relative depth (what this used before) silently breaks the moment the calling code's own
 * location moves. Found live: this exact file runs from two very different depths depending on
 * context — `apps/worker/src/agents/` unbundled in local dev (tsx) and tests, but inlined
 * straight into `apps/api/dist/main.js` in production (tsup's `noExternal` bundles
 * `@retronoodle/worker` into the API's single output file) — four levels up from the bundled
 * file overshoots the repo root by one, landing just outside it, so the directory was
 * genuinely never there to find.
 */
export function findAgentsDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, '.claude', 'agents');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root without finding one
    dir = parent;
  }
  throw new Error(`Could not find a .claude/agents directory above ${startDir}`);
}

/**
 * Reads and parses one of this app's own `.claude/agents/<name>.md` files — this app's own
 * convention for every AI agent it calls (see .claude/agents/README.md for why; no SDK reads
 * this folder automatically, this is the one piece of code that actually does). Cached per name
 * — the file never changes mid-process.
 */
const cache = new Map<string, AgentDefinition>();

export function loadAgent(name: string): AgentDefinition {
  const cached = cache.get(name);
  if (cached) return cached;

  const agentsDir = findAgentsDir(dirname(fileURLToPath(import.meta.url)));
  const raw = readFileSync(join(agentsDir, `${name}.md`), 'utf-8');
  const def = parseAgentFile(raw, name);
  cache.set(name, def);
  return def;
}
