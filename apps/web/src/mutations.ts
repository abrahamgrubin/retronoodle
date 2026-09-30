import { API_URL } from './api';

/** POST /retros/:id/mutations (RN-008). Returns the raw Response — callers (retroStore's
 * sendMutation) decide how to interpret ok/rejected, so this stays a thin fetch wrapper. */
export function postMutation(
  accessToken: string,
  retroId: string,
  envelope: { mutationId: string; type: string; payload: unknown },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchImpl(`${API_URL}/retros/${retroId}/mutations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
}
