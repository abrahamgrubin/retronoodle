import { TopicRemovePayload, TopicRemoveResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * topic.remove: facilitator-only, Discuss phase only — deletes a not-yet-discussed topic
 * outright. Its cards aren't deleted, just ungrouped (`cards.topic_id` is `on delete set null`,
 * and `votes.topic_id` is `on delete cascade` — any votes it got are gone with it, same as the
 * topic itself). Rejects a topic that's already started, same as topic.skip/queue.reorder: once
 * a topic has history (notes, a summary, or is simply already current), deleting it outright
 * would destroy that rather than just tidy up a queue that never needed it.
 */
export const topicRemoveMutation: MutationTypeDef<TopicRemovePayload> = {
  schema: TopicRemovePayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.manageDiscussQueue', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may remove a topic from the queue');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'discuss') {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.remove is not allowed during ${phase}`);
    }

    const existing = await client.query<{ started_at: Date | null }>('select started_at from topics where id = $1 and retro_id = $2', [
      payload.topicId,
      retro.id,
    ]);
    const row = existing.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'Topic not found');
    if (row.started_at) {
      throw new MutationRejected(409, 'already_started', 'Only topics not yet discussed can be removed');
    }

    const cards = await client.query<{ id: string }>('select id from cards where topic_id = $1', [payload.topicId]);
    await client.query('delete from topics where id = $1', [payload.topicId]);

    return TopicRemoveResult.parse({ topicId: payload.topicId, cardIds: cards.rows.map((c) => c.id) });
  },
};
