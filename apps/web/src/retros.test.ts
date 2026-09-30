import { describe, expect, it, vi } from 'vitest';
import { createRetro, JoinError, joinRetro } from './retros';

const retro = {
  id: '00000000-0000-4000-8000-000000000001',
  teamId: '00000000-0000-4000-8000-000000000002',
  name: 'Sprint 1 retro',
  phase: 'setup' as const,
  facilitatorId: '00000000-0000-4000-8000-000000000003',
  templateId: '00000000-0000-4000-8000-000000000004',
  templateSource: 'builtin' as const,
  createdAt: new Date().toISOString(),
  joinCode: 'abc123',
};

describe('createRetro', () => {
  it('sends a client-generated id, name and templateId', async () => {
    let seenBody: { id: string; name: string; templateId: string } | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ...retro, id: seenBody?.id }));
    });

    const created = await createRetro(
      'token-123',
      retro.teamId,
      'Sprint 1 retro',
      retro.templateId,
      fetchImpl as unknown as typeof fetch,
    );
    expect(created.joinCode).toBe('abc123');
    expect(seenBody?.name).toBe('Sprint 1 retro');
    expect(seenBody?.templateId).toBe(retro.templateId);
    expect(seenBody?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('joinRetro', () => {
  it('parses a successful join', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ retroId: retro.id, teamId: retro.teamId, name: retro.name, phase: 'setup' })),
    );
    const joined = await joinRetro('code', 'token-123', fetchImpl as unknown as typeof fetch);
    expect(joined.retroId).toBe(retro.id);
  });

  it('maps 404 to an invalid_link JoinError with the expired-link copy', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(joinRetro('code', 'token-123', fetchImpl as typeof fetch)).rejects.toMatchObject(
      new JoinError('invalid_link', 'This link has expired'),
    );
  });

  it('maps 410 to a retro_closed JoinError with the ended-retro copy', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 410 }));
    await expect(joinRetro('code', 'token-123', fetchImpl as typeof fetch)).rejects.toMatchObject(
      new JoinError('retro_closed', 'This retro has ended'),
    );
  });
});
