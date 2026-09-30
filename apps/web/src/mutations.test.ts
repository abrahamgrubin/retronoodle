import { describe, expect, it, vi } from 'vitest';
import { postMutation } from './mutations';

describe('postMutation', () => {
  it('sends the access token and the envelope as the JSON body', async () => {
    let seenHeaders: Record<string, string> | undefined;
    let seenBody: unknown;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      seenBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ seq: 1, result: {} }));
    });

    const envelope = { mutationId: 'm1', type: 'card.create', payload: { cardId: 'c1', columnId: 'col1', body: 'Hi' } };
    const res = await postMutation('token-123', 'retro-1', envelope, fetchImpl as unknown as typeof fetch);

    expect(res.ok).toBe(true);
    expect(seenHeaders?.Authorization).toBe('Bearer token-123');
    expect(seenHeaders?.['Content-Type']).toBe('application/json');
    expect(seenBody).toEqual(envelope);
  });
});
