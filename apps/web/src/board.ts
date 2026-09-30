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
