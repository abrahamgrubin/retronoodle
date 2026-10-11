import { BoardResponse, type SpeechActivityInterval } from '@retronoodle/shared';
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

/** RN-035: uploads a batch of already clock-corrected on-device VAD intervals — never audio, only
 * timestamps (see speechDetection.ts, which computes them). Best-effort, same shape as the
 * heartbeat above: a dropped batch just means those few seconds of speaking intervals never
 * reached speaker matching, not a reason to surface an error to the participant. */
export async function uploadSpeechActivity(
  accessToken: string,
  retroId: string,
  intervals: SpeechActivityInterval[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (intervals.length === 0) return;
  await fetchImpl(`${API_URL}/retros/${retroId}/speech-activity`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intervals }),
  });
}

/** RN-033: the audio gateway's WebSocket URL — ws(s) is derived from API_URL's own http(s), and
 * the access token travels as a query param (a browser can't set an Authorization header on a
 * WebSocket upgrade request). */
export function audioGatewayUrl(accessToken: string, retroId: string): string {
  const wsUrl = API_URL.replace(/^http/, 'ws');
  return `${wsUrl}/retros/${retroId}/audio-gateway?token=${encodeURIComponent(accessToken)}`;
}
