import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { runTransitionEffect } from './onTransition.js';
import type { LockedRetro } from './registry.js';

const retro: LockedRetro = {
  id: '00000000-0000-4000-8000-000000000001',
  team_id: '00000000-0000-4000-8000-000000000002',
  facilitator_id: '00000000-0000-4000-8000-000000000003',
  phase: 'group',
  cards_revealed: true,
  phase_deadline: null,
};

describe('runTransitionEffect', () => {
  it('is a no-op for a "from->to" pair with no registered effect', async () => {
    const query = vi.fn();
    await runTransitionEffect({ query } as unknown as PoolClient, retro, 'review', 'write');
    expect(query).not.toHaveBeenCalled();
  });

  describe('group->vote (RN-015: "every card belongs to exactly one topic" by Vote)', () => {
    it('turns every still-ungrouped card into its own single-card topic, and touches nothing already grouped', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({
        rows: [
          { id: 'card-1', column_id: 'col-1', body: 'Solo thought' },
          { id: 'card-2', column_id: 'col-1', body: 'Another solo one' },
        ],
      }); // select ... where topic_id is null
      query.mockResolvedValueOnce({ rows: [] }); // card-1's insert+update CTE
      query.mockResolvedValueOnce({ rows: [] }); // card-2's insert+update CTE

      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote');

      expect(query).toHaveBeenCalledTimes(3);
      const lookupCall = query.mock.calls[0] as unknown[];
      expect(lookupCall[0]).toContain('topic_id is null');
      expect(lookupCall[1]).toEqual([retro.id]);

      const card1Call = query.mock.calls[1] as unknown[];
      expect(card1Call[0]).toContain('insert into topics');
      expect(card1Call[1]).toEqual([retro.id, 'col-1', 'Solo thought', 'card-1']);
    });

    it('truncates a long card body into the default topic name', async () => {
      const query = vi.fn();
      const longBody = 'x'.repeat(80);
      query.mockResolvedValueOnce({ rows: [{ id: 'card-1', column_id: 'col-1', body: longBody }] });
      query.mockResolvedValueOnce({ rows: [] });

      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote');

      const insertCall = query.mock.calls[1] as unknown[];
      const name = (insertCall[1] as unknown[])[2] as string;
      expect(name.length).toBe(61); // 60 chars + ellipsis
      expect(name.endsWith('…')).toBe(true);
    });

    it('does nothing when every card is already grouped', async () => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [] });
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote');
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe('vote->group (RN-010, unchanged by RN-015)', () => {
    it('refunds every vote', async () => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [] });
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'vote', 'group');
      expect(query).toHaveBeenCalledTimes(1);
      expect((query.mock.calls[0] as unknown[])[0]).toContain('delete from votes');
    });
  });
});
