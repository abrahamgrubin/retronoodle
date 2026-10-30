import { MyTeamsResponse, TeamMembersResponse, TeamResponse } from '@retronoodle/shared';
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

/** GET /teams/:id/members (RN-062): teammates other than the caller, for the invite checklist. */
export async function fetchTeamMembers(
  accessToken: string,
  teamId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamMembersResponse> {
  const res = await fetchImpl(`${API_URL}/teams/${teamId}/members`, { headers: authHeaders(accessToken) });
  if (!res.ok) throw new Error(`GET /teams/:id/members failed: ${res.status}`);
  return TeamMembersResponse.parse(await res.json());
}
