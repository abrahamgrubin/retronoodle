/**
 * RN-027: "Pino JSON logs with a redaction list (card text, notes, summaries, credentials)."
 *
 * Pino's own `redact` option only matches fixed JSON paths, but retro content shows up under a
 * different key depending on which mutation it came from (card.create's `body`, topic.editSummary's
 * `keyPoints`, an action item's `title`, ...) — an exhaustive path list would be one typo away from
 * missing a new one. This instead redacts by *key name*, recursively, wherever it appears. It's a
 * safety net against a future `request.log.info({ payload }, ...)` someone adds without thinking
 * about what's inside it — not a replacement for "don't log payloads" in the first place (every
 * existing call site in this codebase only ever logs `{ err }`, never a raw mutation payload).
 *
 * Only ever recurses into plain object literals and Error instances (Postgres/PostgREST error
 * shapes carry extra fields like `detail` as own enumerable properties, which a plain
 * `instanceof Error` check alone would miss walking into) — anything else (a live Fastify request/
 * reply, a Buffer, a Date) is returned untouched. Deliberately narrow: wired into the server's own
 * logger (server.ts) via this same check, so it can never reach into — and never risks crashing on
 * — Fastify's own internal request/response objects.
 *
 * What this can't catch: free text that happens to echo a value outside a named field (e.g. a
 * Postgres constraint-violation DETAIL line quoting a column's value inline) — that's a content-
 * scanning problem, a different and much larger effort than a key-name denylist. No such
 * constraint exists on any content-bearing column today (confirmed against the migrations), so
 * this is a real but currently-theoretical gap, not a known live leak.
 */
const SENSITIVE_KEYS = new Set([
  'body',
  'notes',
  'title',
  'detail',
  'keypoints',
  'decisions',
  'disagreements',
  'proposedactionitems',
  'groupsummary',
  'groupsummarytitle',
  'discussionquestions',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'apikey',
  'servicerolekey',
  'joincode',
  'cookie',
]);

export const REDACTED = '[redacted]';

function isRedactable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || value instanceof Error);
}

export function redactForLogging(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (Array.isArray(value)) return value.map((v) => redactForLogging(v, seen));
  if (!isRedactable(value)) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  const out: Record<string, unknown> = {};
  // Error.prototype.message isn't an own enumerable property, so Object.entries below never sees
  // it — preserved explicitly here (error messages are generally safe/useful: "connection
  // refused", not retro content), before any own extra fields (detail, hint, code, ...) are
  // walked and redacted by key the same way a plain object's would be.
  if (value instanceof Error) out.message = value.message;
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactForLogging(val, seen);
  }
  return out;
}
