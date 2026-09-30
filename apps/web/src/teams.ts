import { MyTeamsResponse, TeamResponse } from '@retronoodle/shared';
import { uuidv7 } from 'uuidv7';
import { API_URL } from './api';

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function fetchMyTeams(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<MyTeamsResponse> {
  const res = await fetchImpl(`${API_URL}/me/teams`, { headers: authHeaders(accessToken) });
  if (!res.ok) throw new Error(`GET /me/teams failed: ${res.status}`);
  return MyTeamsResponse.parse(await res.json());
}

export async function createTeam(
  accessToken: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamResponse> {
  const res = await fetchImpl(`${API_URL}/teams`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: uuidv7(), name }),
  });
  if (!res.ok) throw new Error(`POST /teams failed: ${res.status}`);
  return TeamResponse.parse(await res.json());
}
