/** Loose client-side check for the invite dialog's email field — the API's `z.email()` is the real
 * validator; this only decides whether Enter/comma turns the text into a chip. */
const LOOSE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isPlausibleEmail(raw: string): boolean {
  return LOOSE_EMAIL.test(normalizeEmail(raw));
}

/** Splits pasted text ("a@x.com, b@y.com; c@z.com") into addresses, returning the ones that look
 * valid (deduped against `existing`) and the leftovers that don't. */
export function parseEmailInput(text: string, existing: string[]): { added: string[]; rejected: string[] } {
  const seen = new Set(existing);
  const added: string[] = [];
  const rejected: string[] = [];
  for (const piece of text.split(/[\s,;]+/)) {
    if (!piece) continue;
    const email = normalizeEmail(piece);
    if (!isPlausibleEmail(email)) rejected.push(piece);
    else if (!seen.has(email)) {
      seen.add(email);
      added.push(email);
    }
  }
  return { added, rejected };
}
