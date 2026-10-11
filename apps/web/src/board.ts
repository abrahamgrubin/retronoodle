import { BoardResponse } from '@retronoodle/shared';
import { API_URL } from './api';

export async function fetchBoard(
  accessToken: string,
  retroId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BoardResponse> {
  const res = await fetchImpl(`${API_URL}/retros/${retroId}/board`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /retros/:id/board failed: ${res.status}`);
  return BoardResponse.parse(await res.json());
}

/** RN-032: presence heartbeat — also how the server notices a late joiner once a recording
 * session is already active (board.ts's own route). Best-effort: a single missed beat is
 * harmless (ONLINE_WINDOW_SECONDS tolerates it), so callers don't need to handle failure here. */
export async function sendHeartbeat(accessToken: string, retroId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(`${API_URL}/retros/${retroId}/heartbeat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
