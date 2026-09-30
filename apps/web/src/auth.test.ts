import { describe, expect, it, vi } from 'vitest';
import { fetchMe } from './auth';

describe('fetchMe', () => {
  it('sends the access token and timezone headers, and parses the response', async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          displayName: 'Ada Lovelace',
          email: 'ada@example.com',
          avatarUrl: null,
          timezone: 'UTC',
        }),
      );
    });

    const me = await fetchMe('token-123', fetchImpl as unknown as typeof fetch);

    expect(me.displayName).toBe('Ada Lovelace');
    expect(seenHeaders?.Authorization).toBe('Bearer token-123');
    expect(seenHeaders?.['X-Timezone']).toBeTruthy();
  });

  it('rejects a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(fetchMe('bad-token', fetchImpl as typeof fetch)).rejects.toThrow(/401/);
  });
});
