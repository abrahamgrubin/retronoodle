import { allowedActions, TopicRenamePayload, TopicRenameResult, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * topic.rename (RN-015): "Anyone can rename a group; the last rename wins and syncs to all" — no
 * ownership check (can.ts has nothing for topics), just the same Group-phase `cardGroup` gate
 * grouping itself uses. Renaming once grouping is over (Vote onward) isn't this story's AC —
 * later stories can widen the gate if a topic needs renaming beyond Group.
 */
export const topicRenameMutation: MutationTypeDef<TopicRenamePayload> = {
  schema: TopicRenamePayload,
  async apply({ client, retro, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).cardGroup) {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.rename is not allowed during ${phase}`);
    }

    const existing = await client.query<{ column_id: string; vote_count: number }>(
      'select column_id, vote_count from topics where id = $1 and retro_id = $2',
      [payload.topicId, retro.id],
    );
    const topic = existing.rows[0];
    if (!topic) throw new MutationRejected(404, 'not_found', 'Topic not found');

    await client.query('update topics set name = $1 where id = $2', [payload.name, payload.topicId]);

    // Renaming is Group-phase only (see the cardGroup gate above), and RN-019's discuss-queue
    // fields are only ever set starting at the vote->discuss transition — long after Group ends
    // — so they're always null here, same reasoning as topicHelpers.ts's createTopicFromCardIds.
    return TopicRenameResult.parse({
      topic: {
        id: payload.topicId,
        columnId: topic.column_id,
        name: payload.name,
        voteCount: topic.vote_count,
        discussionOrder: null,
        startedAt: null,
        endedAt: null,
        groupSummaryTitle: null,
        groupSummary: null,
        discussionQuestions: null,
      },
    });
  },
};
