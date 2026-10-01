import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { reactionToggleMutation } from './reactionToggle.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const cardId = '00000000-0000-4000-8000-000000000011';

function retroAt(phase: string, cardsRevealed = true): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: '00000000-0000-4000-8000-000000000003',
    phase,
    cards_revealed: cardsRevealed,
    phase_deadline: null,
  };
}

function fakeClient(opts: { cardExists?: boolean; alreadyReacted?: boolean }) {
  const { cardExists = true, alreadyReacted = false } = opts;
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: cardExists ? [{ x: 1 }] : [] }); // card exists lookup
  if (cardExists) {
    query.mockResolvedValueOnce({ rows: alreadyReacted ? [{ x: 1 }] : [] }); // existing reaction lookup
    query.mockResolvedValueOnce({ rows: [] }); // insert or delete
  }
  return { query } as unknown as PoolClient;
}

const payload = { cardId, emoji: '👍' as const };

describe('reaction.toggle', () => {
  it('adds a reaction the first time', async () => {
    const client = fakeClient({ alreadyReacted: false });
    const result = await reactionToggleMutation.apply({ client, retro: retroAt('group'), user, payload });
    expect(result).toEqual({ cardId, userId: user.id, emoji: '👍', added: true });
    const insertCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[2] as unknown[];
    expect(insertCall[0]).toContain('insert into card_reactions');
    expect(insertCall[1]).toEqual([cardId, user.id, '👍']);
  });

  it('removes the reaction the second time (toggle off)', async () => {
    const client = fakeClient({ alreadyReacted: true });
    const result = await reactionToggleMutation.apply({ client, retro: retroAt('group'), user, payload });
    expect(result).toEqual({ cardId, userId: user.id, emoji: '👍', added: false });
    const deleteCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[2] as unknown[];
    expect(deleteCall[0]).toContain('delete from card_reactions');
    expect(deleteCall[1]).toEqual([cardId, user.id, '👍']);
  });

  it('rejects an unknown card', async () => {
    const client = fakeClient({ cardExists: false });
    await expect(reactionToggleMutation.apply({ client, retro: retroAt('group'), user, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('rejects during Review and Vote (cardReact: "never")', async () => {
    for (const phase of ['review', 'vote']) {
      const client = fakeClient({});
      await expect(reactionToggleMutation.apply({ client, retro: retroAt(phase), user, payload })).rejects.toMatchObject({
        status: 409,
        code: 'phase_not_allowed',
      });
    }
  });

  it('rejects on a hidden (not-yet-revealed) card in Write', async () => {
    const client = fakeClient({});
    await expect(
      reactionToggleMutation.apply({ client, retro: retroAt('write', false), user, payload }),
    ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
  });

  it('allows anyone to react once cards are revealed in Write', async () => {
    const client = fakeClient({ alreadyReacted: false });
    const result = await reactionToggleMutation.apply({ client, retro: retroAt('write', true), user, payload });
    expect(result).toMatchObject({ added: true });
  });

  it.each(['group', 'discuss', 'wrap_up'])('allows reacting during %s ("always")', async (phase) => {
    const client = fakeClient({ alreadyReacted: false });
    const result = await reactionToggleMutation.apply({ client, retro: retroAt(phase), user, payload });
    expect(result).toMatchObject({ added: true });
  });
});
