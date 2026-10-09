import { describe, expect, it, vi } from 'vitest';
import { createTeam, fetchMyTeams } from './teams';

const team = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Platform Team',
  createdBy: '00000000-0000-4000-8000-000000000002',
  retroCadenceDays: 14,
  transcriptRetentionDays: 1 as const,
  role: 'admin' as const,
  createdAt: new Date().toISOString(),
};

describe('fetchMyTeams', () => {
  it('sends the access token and parses the response', async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify([team]));
    });

    const teams = await fetchMyTeams('token-123', fetchImpl as unknown as typeof fetch);
    expect(teams).toHaveLength(1);
    expect(teams[0]?.name).toBe('Platform Team');
    expect(seenHeaders?.Authorization).toBe('Bearer token-123');
  });

  it('rejects a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }));
    await expect(fetchMyTeams('token-123', fetchImpl as typeof fetch)).rejects.toThrow(/403/);
  });
});

describe('createTeam', () => {
  it('sends a client-generated UUIDv7 id and the team name', async () => {
    let seenBody: { id: string; name: string } | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ...team, id: seenBody?.id, name: seenBody?.name }));
    });

    const created = await createTeam('token-123', 'New Team', fetchImpl as unknown as typeof fetch);
    expect(created.name).toBe('New Team');
    expect(seenBody?.name).toBe('New Team');
    expect(seenBody?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
