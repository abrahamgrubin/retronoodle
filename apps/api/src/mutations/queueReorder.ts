import { QueueReorderPayload, QueueReorderResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { toTopic, updateTopicReturningFull, type TopicRow } from './discussHelpers.js';

/**
 * queue.reorder (RN-019): facilitator-only, Discuss phase only — drags a not-yet-discussed topic
 * to a new spot in the "Up next" list. The client computes the fractional `discussionOrder` key
 * itself (same division of labor as card.move's `position` — cardMove.ts), this just writes it.
 * Rejects a topic that's already started (current or already discussed) — reordering only ever
 * applies to what's still ahead, matching the layout spec's drag handle only showing in Up next.
 */
export const queueReorderMutation: MutationTypeDef<QueueReorderPayload> = {
  schema: QueueReorderPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.manageDiscussQueue', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may reorder the discuss queue');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'discuss') {
      throw new MutationRejected(409, 'phase_not_allowed', `queue.reorder is not allowed during ${phase}`);
    }

    const existing = await client.query<{ started_at: Date | null }>('select started_at from topics where id = $1 and retro_id = $2', [
      payload.topicId,
      retro.id,
    ]);
    const row = existing.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'Topic not found');
    if (row.started_at) {
      throw new MutationRejected(409, 'already_started', 'Only topics not yet discussed can be reordered');
    }

    const updated = await client.query<TopicRow>(updateTopicReturningFull('update topics set discussion_order = $1 where id = $2'), [
      payload.discussionOrder,
      payload.topicId,
    ]);

    return QueueReorderResult.parse({ topic: toTopic(updated.rows[0]!) });
  },
};
