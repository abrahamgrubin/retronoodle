import {
  ActionItemStatus,
  ActionItemStatusChangeResult,
  ActionItemStatusHistoryResponse,
  TeamActionItemsResponse,
} from '@retronoodle/shared';
import { API_URL } from './api';

export async function fetchTeamActions(accessToken: string, teamId: string, fetchImpl: typeof fetch = fetch): Promise<TeamActionItemsResponse> {
  const res = await fetchImpl(`${API_URL}/teams/${teamId}/actions`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /teams/:id/actions failed: ${res.status}`);
  return TeamActionItemsResponse.parse(await res.json());
}

export async function fetchActionItemHistory(
  accessToken: string,
  teamId: string,
  itemId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ActionItemStatusHistoryResponse> {
  const res = await fetchImpl(`${API_URL}/teams/${teamId}/actions/${itemId}/history`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /teams/:id/actions/:itemId/history failed: ${res.status}`);
  return ActionItemStatusHistoryResponse.parse(await res.json());
}

export async function postActionItemStatus(
  accessToken: string,
  teamId: string,
  itemId: string,
  status: ActionItemStatus,
  fetchImpl: typeof fetch = fetch,
): Promise<ActionItemStatusChangeResult> {
  const res = await fetchImpl(`${API_URL}/teams/${teamId}/actions/${itemId}/status`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`POST /teams/:id/actions/:itemId/status failed: ${res.status}`);
  return ActionItemStatusChangeResult.parse(await res.json());
}
