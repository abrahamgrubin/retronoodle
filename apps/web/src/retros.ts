import { CreateRetroRequest, JoinResponse, RetroCreatedResponse } from '@retronoodle/shared';
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
