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
  vote_budget: 3,
};

describe('runTransitionEffect', () => {
  it('is a no-op for a "from->to" pair with no registered effect', async () => {
    const query = vi.fn();
    await runTransitionEffect({ query } as unknown as PoolClient, retro, 'discuss', 'wrap_up');
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
      query.mockResolvedValueOnce({ rows: [] }); // RN-017: discard pending suggestions

      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote');

      expect(query).toHaveBeenCalledTimes(4);
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
      query.mockResolvedValueOnce({ rows: [] }); // RN-017: discard pending suggestions

      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote');

      const insertCall = query.mock.calls[1] as unknown[];
      const name = (insertCall[1] as unknown[])[2] as string;
      expect(name.length).toBe(61); // 60 chars + ellipsis
      expect(name.endsWith('…')).toBe(true);
    });

    it('does nothing to cards when every card is already grouped, but still discards pending suggestions', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({ rows: [] }); // no ungrouped cards
      query.mockResolvedValueOnce({ rows: [] }); // discard pending suggestions
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote');
      expect(query).toHaveBeenCalledTimes(2);
    });

    // RN-017: "Discard pending suggestions on group -> vote."
    it('marks every still-pending suggestion rejected', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({ rows: [] }); // no ungrouped cards
      query.mockResolvedValueOnce({ rows: [] }); // discard pending suggestions
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote');

      const discardCall = query.mock.calls[1] as unknown[];
      expect(discardCall[0]).toContain("status = 'rejected'");
      expect(discardCall[0]).toContain("status = 'pending'");
      expect(discardCall[1]).toEqual([retro.id]);
    });

    // Homework: grouping locks in the moment Vote starts.
    it('enqueues ai.summarizeGroup for every topic when a job sender is provided', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({ rows: [] }); // no ungrouped cards
      query.mockResolvedValueOnce({ rows: [] }); // discard pending suggestions
      query.mockResolvedValueOnce({ rows: [{ id: 'topic-a' }, { id: 'topic-b' }] }); // select topics
      const jobs = { send: vi.fn().mockResolvedValue('job-id') };

      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote', jobs);

      expect(jobs.send).toHaveBeenCalledWith('ai.summarizeGroup', { topicId: 'topic-a' });
      expect(jobs.send).toHaveBeenCalledWith('ai.summarizeGroup', { topicId: 'topic-b' });
    });

    it('does not query topics at all when there is no job sender', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote');
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('swallows a job-send failure for one topic and still enqueues the rest', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [{ id: 'topic-a' }, { id: 'topic-b' }] });
      const send = vi.fn().mockRejectedValueOnce(new Error('queue unavailable')).mockResolvedValueOnce('job-id');
      await expect(
        runTransitionEffect({ query } as unknown as PoolClient, retro, 'group', 'vote', { send }),
      ).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  describe('write->group (RN-017: enqueue ai.groupCards)', () => {
    it('enqueues ai.groupCards when a job sender is provided', async () => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [] }); // cards_revealed update
      const jobs = { send: vi.fn().mockResolvedValue('job-id') };
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'write', 'group', jobs);
      expect(jobs.send).toHaveBeenCalledWith('ai.groupCards', { retroId: retro.id });
    });

    it('does nothing extra, and does not throw, when there is no job sender', async () => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [] });
      await expect(runTransitionEffect({ query } as unknown as PoolClient, retro, 'write', 'group')).resolves.toBeUndefined();
    });

    it('swallows a job-send failure — AI grouping is best-effort, never blocks the transition', async () => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [] });
      const jobs = { send: vi.fn().mockRejectedValue(new Error('queue unavailable')) };
      await expect(runTransitionEffect({ query } as unknown as PoolClient, retro, 'write', 'group', jobs)).resolves.toBeUndefined();
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

  describe('review->write (RN-025: "unmarked items are recorded as carried")', () => {
    it('inserts a carried review row for this retro, scoped to the team, excluding this retro\'s own new items', async () => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [] });
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'review', 'write');
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("'carried'");
      expect(sql).toContain('on conflict (action_item_id, retro_id) do nothing');
      expect(sql).toContain('source_retro_id <> $1');
      expect(params).toEqual([retro.id, retro.team_id]);
    });
  });

  describe('vote->discuss (RN-018: "reveal counts ... first topic becomes current")', () => {
    it('writes vote_count for every topic, ranked by votes desc then creation time, and starts only the first', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({
        rows: [
          { id: 'topic-most-votes', vote_count: 5 },
          { id: 'topic-fewer-votes', vote_count: 2 },
          { id: 'topic-no-votes', vote_count: 0 },
        ],
      }); // the ranking select (already ORDER BY vote_count desc, created_at asc in SQL)
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });

      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'vote', 'discuss');

      expect(query).toHaveBeenCalledTimes(4);
      const rankingCall = query.mock.calls[0] as unknown[];
      expect(rankingCall[0]).toContain('order by count(v.id) desc, t.created_at asc');

      const firstUpdate = query.mock.calls[1] as unknown[];
      expect(firstUpdate[1]).toEqual([5, expect.any(String), expect.any(Date), 'topic-most-votes']);
      const secondUpdate = query.mock.calls[2] as unknown[];
      expect(secondUpdate[1]).toEqual([2, expect.any(String), null, 'topic-fewer-votes']);
      const thirdUpdate = query.mock.calls[3] as unknown[];
      expect(thirdUpdate[1]).toEqual([0, expect.any(String), null, 'topic-no-votes']);

      // discussion_order keys sort in rank order.
      const firstOrder = (firstUpdate[1] as unknown[])[1] as string;
      const secondOrder = (secondUpdate[1] as unknown[])[1] as string;
      expect(firstOrder < secondOrder).toBe(true);
    });

    it('does nothing when there are no topics', async () => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [] });
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'vote', 'discuss');
      expect(query).toHaveBeenCalledTimes(1);
    });

    // Homework: the top-ranked topic becomes current the moment Discuss starts.
    it('enqueues ai.suggestQuestions for the top-ranked topic only, when a job sender is provided', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({ rows: [{ id: 'topic-most-votes', vote_count: 5 }, { id: 'topic-fewer-votes', vote_count: 2 }] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      const jobs = { send: vi.fn().mockResolvedValue('job-id') };

      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'vote', 'discuss', jobs);

      expect(jobs.send).toHaveBeenCalledTimes(1);
      expect(jobs.send).toHaveBeenCalledWith('ai.suggestQuestions', { topicId: 'topic-most-votes' });
    });

    it('does nothing extra, and does not throw, when there is no job sender', async () => {
      const query = vi.fn();
      query.mockResolvedValueOnce({ rows: [{ id: 'topic-a', vote_count: 1 }] });
      query.mockResolvedValueOnce({ rows: [] });
      await expect(runTransitionEffect({ query } as unknown as PoolClient, retro, 'vote', 'discuss')).resolves.toBeUndefined();
    });

    it('does not enqueue anything when there are no topics, even with a job sender', async () => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [] });
      const jobs = { send: vi.fn() };
      await runTransitionEffect({ query } as unknown as PoolClient, retro, 'vote', 'discuss', jobs);
      expect(jobs.send).not.toHaveBeenCalled();
    });
  });
});
