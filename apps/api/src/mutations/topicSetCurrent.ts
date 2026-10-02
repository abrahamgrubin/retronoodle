import { TopicSetCurrentPayload, TopicQueueResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { endCurrentTopic, startTopic } from './discussHelpers.js';

/**
 * topic.setCurrent (RN-019): facilitator-only, Discuss phase only — the "jump" gesture, straight
 * to any topic in the queue regardless of order (including one already discussed, which simply
 * reopens it — see discussHelpers.ts's startTopic). Jumping to the topic that's already current
 * is a no-op rather than needlessly re-stamping its `started_at`.
 */
export const topicSetCurrentMutation: MutationTypeDef<TopicSetCurrentPayload> = {
  schema: TopicSetCurrentPayload,
  async apply({ client, retro, user, payload, jobs }) {
    if (!can(user, 'retro.manageDiscussQueue', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may jump the discuss queue');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'discuss') {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.setCurrent is not allowed during ${phase}`);
    }

    const target = await client.query<{ started_at: Date | null; ended_at: Date | null }>(
      'select started_at, ended_at from topics where id = $1 and retro_id = $2',
      [payload.topicId, retro.id],
    );
    const row = target.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'Topic not found');

    if (row.started_at && !row.ended_at) {
      return TopicQueueResult.parse({ endedTopic: null, startedTopic: null });
    }

    const endedTopic = await endCurrentTopic(client, retro.id, jobs);
    const startedTopic = await startTopic(client, payload.topicId);

    return TopicQueueResult.parse({ endedTopic, startedTopic });
  },
};
