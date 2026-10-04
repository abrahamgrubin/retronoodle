import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
 * Reads and parses one of this app's own `.claude/agents/<name>.md` files — this app's own
 * convention for every AI agent it calls (see .claude/agents/README.md for why; no SDK reads
 * this folder automatically, this is the one piece of code that actually does). Loaded relative
 * to this module's own file location, not `process.cwd()` — pnpm/turbo run per-package scripts
 * with that package's own directory as cwd, not the repo root, so a cwd-relative path broke
 * under `pnpm --filter @retronoodle/worker test` in exactly this way before (see prompt.ts's old
 * version of this same comment, RN-017). Cached per name — the file never changes mid-process.
 */
const cache = new Map<string, AgentDefinition>();

export function loadAgent(name: string): AgentDefinition {
  const cached = cache.get(name);
  if (cached) return cached;

  const raw = readFileSync(fileURLToPath(new URL(`../../../../.claude/agents/${name}.md`, import.meta.url)), 'utf-8');
  const def = parseAgentFile(raw, name);
  cache.set(name, def);
  return def;
}
