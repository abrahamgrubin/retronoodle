/** The server only ever stores a join code's hash (RN-006: "the plaintext code is never stored
 * in the database"), so the one moment a browser ever sees the real code is right after
 * `POST /teams/:id/retros` or `POST /retros/:id/join-link/regenerate` responds. Caching it here
 * (keyed by retro id, this origin only — localStorage, never sent anywhere) is what lets the
 * "Copy share link" button on the board page work on a second visit/reload without having to call
 * regenerate (and invalidate whatever link's already been shared) every single time.
 */
const KEY_PREFIX = 'retronoodle:joinCode:';

export function getCachedJoinCode(retroId: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + retroId);
  } catch {
    return null; // Private browsing / blocked storage — caller falls back to regenerating.
  }
}

export function setCachedJoinCode(retroId: string, joinCode: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + retroId, joinCode);
  } catch {
    // Nothing useful to do — the next "copy link" click just regenerates again instead.
  }
}
