import { RecapResponse } from '@retronoodle/shared';
import { API_URL } from './api';

export async function fetchRecap(accessToken: string, retroId: string, fetchImpl: typeof fetch = fetch): Promise<RecapResponse> {
  const res = await fetchImpl(`${API_URL}/retros/${retroId}/recap`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /retros/:id/recap failed: ${res.status}`);
  return RecapResponse.parse(await res.json());
}
