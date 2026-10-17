import { CreateRetroRequest, JoinResponse, RetroCreatedResponse, TeamRetrosResponse } from '@retronoodle/shared';
import { uuidv7 } from 'uuidv7';
import { API_URL } from './api';

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function createRetro(
  accessToken: string,
  teamId: string,
  name: string,
  templateId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RetroCreatedResponse> {
  const body: CreateRetroRequest = { id: uuidv7(), name, templateId };
  const res = await fetchImpl(`${API_URL}/teams/${teamId}/retros`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /teams/:id/retros failed: ${res.status}`);
  return RetroCreatedResponse.parse(await res.json());
}

/** POST /retros/:id/join-link/regenerate (RN-006, facilitator-only): the only way to ever get the
 * plaintext join code back after creation — the server only ever stores its hash, by design (the
 * story's own AC: "the plaintext code is never stored in the database") — so this necessarily
 * invalidates whatever code was issued before it. Callers cache the result (joinLinkStorage.ts)
 * rather than calling this on every "copy link" click, which would otherwise break a link
 * already shared with someone who hasn't joined yet. */
export async function regenerateJoinLink(
  accessToken: string,
  retroId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RetroCreatedResponse> {
  const res = await fetchImpl(`${API_URL}/retros/${retroId}/join-link/regenerate`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`POST /retros/:id/join-link/regenerate failed: ${res.status}`);
  return RetroCreatedResponse.parse(await res.json());
}

export async function fetchTeamRetros(
  accessToken: string,
  teamId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamRetrosResponse> {
  const res = await fetchImpl(`${API_URL}/teams/${teamId}/retros`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`GET /teams/:id/retros failed: ${res.status}`);
  return TeamRetrosResponse.parse(await res.json());
}

export class JoinError extends Error {
  code: 'invalid_link' | 'retro_closed' | 'unknown';

  constructor(code: 'invalid_link' | 'retro_closed' | 'unknown', message: string) {
    super(message);
    this.name = 'JoinError';
    this.code = code;
  }
}

/** GET /join/:code — maps the API's status codes to the exact copy RN-006 specifies. */
export async function joinRetro(
  code: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JoinResponse> {
  const res = await fetchImpl(`${API_URL}/join/${encodeURIComponent(code)}`, {
    headers: authHeaders(accessToken),
  });
  if (res.status === 404) throw new JoinError('invalid_link', 'This link has expired');
  if (res.status === 410) throw new JoinError('retro_closed', 'This retro has ended');
  if (!res.ok) throw new JoinError('unknown', `Join failed: ${res.status}`);
  return JoinResponse.parse(await res.json());
}
