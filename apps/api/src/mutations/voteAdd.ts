import { randomUUID } from 'node:crypto';
import { allowedActions, VoteAddPayload, VoteAddResult, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { computeVotingProgress } from './voteHelpers.js';

/**
 * vote.add (RN-018): "uses the atomic update from 4.5; no returned row -> 409 no_votes_left."
 * `votes` is one row per dot (multiple dots on one topic are allowed), not a counter column, so
 * "atomic" here comes from the mutation pipeline's own per-retro `FOR UPDATE` lock — every
 * mutation against this retro already serializes through that one row, so a plain
 * count-then-insert is race-free the same way it is for e.g. cardMove's dissolve check: no two
 * `vote.add` calls for this user, on this retro, ever run concurrently in the first place.
 *
 * No ownership/facilitator check (unlike card.edit's authorId check) — any team member present
 * may spend their own budget on any topic; only the phase gate (`allowedActions(phase).vote`)
 * restricts this at all.
 */
export const voteAddMutation: MutationTypeDef<VoteAddPayload> = {
  schema: VoteAddPayload,
  actorPrivateResult: (result) => (result as VoteAddResult).progress,
  async apply({ client, retro, user, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).vote) {
      throw new MutationRejected(409, 'phase_not_allowed', `vote.add is not allowed during ${phase}`);
    }

    const topic = await client.query('select 1 from topics where id = $1 and retro_id = $2', [payload.topicId, retro.id]);
    if (topic.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Topic not found');

    const used = await client.query<{ count: number }>('select count(*)::int as count from votes where retro_id = $1 and user_id = $2', [
      retro.id,
      user.id,
    ]);
    const usedCount = used.rows[0]!.count;
    if (usedCount >= retro.vote_budget) {
      throw new MutationRejected(409, 'no_votes_left', 'No votes left to spend');
    }

    await client.query('insert into votes (id, retro_id, topic_id, user_id) values ($1, $2, $3, $4)', [
      randomUUID(),
      retro.id,
      payload.topicId,
      user.id,
    ]);

    const myCount = await client.query<{ count: number }>(
      'select count(*)::int as count from votes where retro_id = $1 and user_id = $2 and topic_id = $3',
      [retro.id, user.id, payload.topicId],
    );
    const progress = await computeVotingProgress(client, retro.id, retro.vote_budget);

    return VoteAddResult.parse({
      topicId: payload.topicId,
      myCount: myCount.rows[0]!.count,
      remaining: retro.vote_budget - (usedCount + 1),
      progress,
    });
  },
};
