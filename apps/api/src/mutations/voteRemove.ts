import { allowedActions, VoteRemovePayload, VoteRemoveResult, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { computeVotingProgress } from './voteHelpers.js';

/** vote.remove (RN-018): "decrements" — deletes exactly one of the caller's own dots on this
 * topic (dots are fungible, so it doesn't matter which row). Same phase gate and no-ownership-
 * check reasoning as vote.add. */
export const voteRemoveMutation: MutationTypeDef<VoteRemovePayload> = {
  schema: VoteRemovePayload,
  actorPrivateResult: (result) => (result as VoteRemoveResult).progress,
  async apply({ client, retro, user, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).vote) {
      throw new MutationRejected(409, 'phase_not_allowed', `vote.remove is not allowed during ${phase}`);
    }

    const deleted = await client.query(
      `delete from votes
       where id = (select id from votes where retro_id = $1 and user_id = $2 and topic_id = $3 limit 1)
       returning id`,
      [retro.id, user.id, payload.topicId],
    );
    if (deleted.rows.length === 0) {
      throw new MutationRejected(409, 'no_votes_on_topic', 'No votes on this topic to remove');
    }

    const myCount = await client.query<{ count: number }>(
      'select count(*)::int as count from votes where retro_id = $1 and user_id = $2 and topic_id = $3',
      [retro.id, user.id, payload.topicId],
    );
    const usedCount = await client.query<{ count: number }>(
      'select count(*)::int as count from votes where retro_id = $1 and user_id = $2',
      [retro.id, user.id],
    );
    const progress = await computeVotingProgress(client, retro.id, retro.vote_budget);

    return VoteRemoveResult.parse({
      topicId: payload.topicId,
      myCount: myCount.rows[0]!.count,
      remaining: retro.vote_budget - usedCount.rows[0]!.count,
      progress,
    });
  },
};
