import { TemplatesResponse } from '@retronoodle/shared';
import { API_URL } from './api';

export async function fetchTeamTemplates(
  accessToken: string,
  teamId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TemplatesResponse> {
  const res = await fetchImpl(`${API_URL}/teams/${teamId}/templates`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /teams/:id/templates failed: ${res.status}`);
  return TemplatesResponse.parse(await res.json());
}
