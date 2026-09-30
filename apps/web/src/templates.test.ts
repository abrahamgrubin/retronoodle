import { describe, expect, it, vi } from 'vitest';
import { fetchTeamTemplates } from './templates';

describe('fetchTeamTemplates', () => {
  it('sends the access token and parses the response', async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify([
          {
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Start / Stop / Continue',
            source: 'builtin',
            columns: [{ title: 'Start', prompt: 'p', color: 'green' }],
          },
        ]),
      );
    });

    const templates = await fetchTeamTemplates('token-123', 'team-1', fetchImpl as unknown as typeof fetch);
    expect(templates).toHaveLength(1);
    expect(templates[0]?.name).toBe('Start / Stop / Continue');
    expect(seenHeaders?.Authorization).toBe('Bearer token-123');
  });

  it('rejects a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }));
    await expect(fetchTeamTemplates('token-123', 'team-1', fetchImpl as typeof fetch)).rejects.toThrow(/403/);
  });
});
