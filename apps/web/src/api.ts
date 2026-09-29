import { HealthResponse } from '@retronoodle/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Calls GET /health and validates the body with the shared schema. */
export async function fetchHealth(fetchImpl: typeof fetch = fetch): Promise<HealthResponse> {
  const res = await fetchImpl(`${API_URL}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return HealthResponse.parse(await res.json());
}
