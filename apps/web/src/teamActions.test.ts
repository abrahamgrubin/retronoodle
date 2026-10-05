import { describe, expect, it, vi } from 'vitest';
import { fetchActionItemHistory, fetchTeamActions, postActionItemStatus } from './teamActions';

const item = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Ship it',
  ownerId: null,
  ownerName: null,
  dueDate: null,
  status: 'open',
  origin: 'manual',
  completedAt: null,
  sourceRetroId: '00000000-0000-4000-8000-000000000002',
  sourceRetroName: 'Sprint 1 retro',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('fetchTeamActions', () => {
  it('sends the access token and parses the response', async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ items: [item] }));
    });

    const result = await fetchTeamActions('token-123', 'team-1', fetchImpl as unknown as typeof fetch);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Ship it');
    expect(seenHeaders?.Authorization).toBe('Bearer token-123');
  });

  it('rejects a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }));
    await expect(fetchTeamActions('token-123', 'team-1', fetchImpl as typeof fetch)).rejects.toThrow(/403/);
  });
});

describe('fetchActionItemHistory', () => {
  it('parses the response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            entries: [
              {
                id: '00000000-0000-4000-8000-000000000003',
                fromStatus: 'open',
                toStatus: 'done',
                actorId: null,
                actorName: null,
                createdAt: '2026-01-02T00:00:00.000Z',
              },
            ],
          }),
        ),
    );
    const result = await fetchActionItemHistory('token-123', 'team-1', 'item-1', fetchImpl as unknown as typeof fetch);
    expect(result.entries).toHaveLength(1);
  });

  it('rejects a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(fetchActionItemHistory('token-123', 'team-1', 'item-1', fetchImpl as typeof fetch)).rejects.toThrow(/404/);
  });
});

describe('postActionItemStatus', () => {
  it('sends the status in the body and parses the response', async () => {
    let seenBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenBody = init?.body as string;
      return new Response(JSON.stringify({ item: { ...item, status: 'done' } }));
    });

    const result = await postActionItemStatus('token-123', 'team-1', 'item-1', 'done', fetchImpl as unknown as typeof fetch);
    expect(result.item.status).toBe('done');
    expect(JSON.parse(seenBody!)).toEqual({ status: 'done' });
  });

  it('rejects a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 409 }));
    await expect(postActionItemStatus('token-123', 'team-1', 'item-1', 'done', fetchImpl as typeof fetch)).rejects.toThrow(/409/);
  });
});
