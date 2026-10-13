import { TopicSkipPayload, TopicSkipResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { toTopic, updateTopicReturningFull, type TopicRow } from './discussHelpers.js';

/**
 * topic.skip: facilitator-only, Discuss phase only — marks a not-yet-discussed topic as
 * discussed without ever making it current. It moves straight to the "Discussed" list with no
 * notes or summary, as if the team passed over it on purpose. Setting both `started_at` and
 * `ended_at` to the same instant is what "discussed, but never current" means here — there's no
 * separate "skipped" status to track (RN-019's own `current topic = started_at set, ended_at
 * null` rule already treats this topic as finished the instant it's skipped, same as any other).
 */
export const topicSkipMutation: MutationTypeDef<TopicSkipPayload> = {
  schema: TopicSkipPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.manageDiscussQueue', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may skip a topic');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'discuss') {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.skip is not allowed during ${phase}`);
    }

    const existing = await client.query<{ started_at: Date | null }>('select started_at from topics where id = $1 and retro_id = $2', [
      payload.topicId,
      retro.id,
    ]);
    const row = existing.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'Topic not found');
    if (row.started_at) {
      throw new MutationRejected(409, 'already_started', 'Only topics not yet discussed can be skipped');
    }

    const updated = await client.query<TopicRow>(
      updateTopicReturningFull('update topics set started_at = now(), ended_at = now() where id = $1'),
      [payload.topicId],
    );

    return TopicSkipResult.parse({ topic: toTopic(updated.rows[0]!) });
  },
};
