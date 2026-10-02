import { TopicNextPayload, TopicQueueResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { endCurrentTopic, startTopic } from './discussHelpers.js';

/**
 * topic.next (RN-019): facilitator-only, Discuss phase only — "walk through topics in vote
 * order." Ends whichever topic is current (if any) and starts the first topic in the "Up next"
 * queue (never-started, ordered by `discussion_order`) — not "the index right after whichever one
 * just ended," so jumping around with topic.setCurrent and then hitting Next always resumes from
 * the front of whatever's left, with no separate cursor to keep in sync. Starting nothing (queue
 * empty) is exactly the "Finish discussion" case ("last topic... moves to Wrap up") — this
 * mutation only ever touches topics; BoardPage.tsx is what also calls phase.next right after.
 */
export const topicNextMutation: MutationTypeDef<TopicNextPayload> = {
  schema: TopicNextPayload,
  async apply({ client, retro, user, jobs }) {
    if (!can(user, 'retro.manageDiscussQueue', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may advance the discuss queue');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'discuss') {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.next is not allowed during ${phase}`);
    }

    const endedTopic = await endCurrentTopic(client, retro.id, jobs);

    const upNext = await client.query<{ id: string }>(
      'select id from topics where retro_id = $1 and started_at is null order by discussion_order asc nulls last limit 1',
      [retro.id],
    );
    const nextRow = upNext.rows[0];
    const startedTopic = nextRow ? await startTopic(client, nextRow.id, jobs) : null;

    return TopicQueueResult.parse({ endedTopic, startedTopic });
  },
};
