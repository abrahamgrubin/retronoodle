import type { PoolClient } from 'pg';
import type { VotingProgress } from '@retronoodle/shared';

/**
 * "5 of 8 done voting" (RN-018) — shared by vote.add and vote.remove, since both can flip a
 * participant's own done/not-done status. `done` means this participant has spent their whole
 * `voteBudget`; `total` is everyone who attended (retro_participants), not just whoever's voted
 * so far.
 *
 * Not shared with routes/board.ts's own version of this same computation: that one runs over
 * supabase-js/PostgREST outside a transaction (the initial snapshot fetch), this one runs over
 * the raw `pg` client inside the mutation's already-locked transaction — different query
 * surfaces, nothing to usefully share beyond the shape of the result.
 */
export async function computeVotingProgress(client: PoolClient, retroId: string, voteBudget: number): Promise<VotingProgress> {
  const { rows } = await client.query<{ total: number; done: number }>(
    `select
       (select count(*)::int from retro_participants where retro_id = $1) as total,
       (select count(*)::int from (
          select user_id from votes where retro_id = $1 group by user_id having count(*) >= $2
        ) as done_users) as done`,
    [retroId, voteBudget],
  );
  const row = rows[0]!;
  return { done: row.done, total: row.total };
}
