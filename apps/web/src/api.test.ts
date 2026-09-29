import { describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './api';

describe('fetchHealth', () => {
  it('parses a valid health body with the shared schema', async () => {
    const time = new Date().toISOString();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, time })));
    await expect(fetchHealth(fetchImpl as typeof fetch)).resolves.toEqual({ ok: true, time });
  });

  it('rejects a body that does not match the schema', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false })));
    await expect(fetchHealth(fetchImpl as typeof fetch)).rejects.toThrow();
  });

  it('rejects a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(fetchHealth(fetchImpl as typeof fetch)).rejects.toThrow(/503/);
  });
});
