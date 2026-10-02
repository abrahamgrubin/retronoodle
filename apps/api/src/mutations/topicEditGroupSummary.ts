import { TopicEditGroupSummaryPayload, TopicEditGroupSummaryResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { toTopic, updateTopicReturningFull, type TopicRow } from './discussHelpers.js';

/**
 * topic.editGroupSummary (homework): "the facilitator to be able to edit the summary during the
 * voting phase." Facilitator-only, Vote phase only — group-summarizer's output is meant to be
 * read by every voter, but only the facilitator may correct it. Overwrites unconditionally,
 * whether the agent's own draft is still there, already edited once, or never ran at all (a
 * retro with no ANTHROPIC_API_KEY has `groupSummary: null` forever otherwise — the facilitator
 * can just write one by hand).
 */
export const topicEditGroupSummaryMutation: MutationTypeDef<TopicEditGroupSummaryPayload> = {
  schema: TopicEditGroupSummaryPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.editAiSummary', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may edit the group summary');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'vote') {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.editGroupSummary is not allowed during ${phase}`);
    }

    const existing = await client.query('select id from topics where id = $1 and retro_id = $2', [payload.topicId, retro.id]);
    if (existing.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Topic not found');

    const updated = await client.query<TopicRow>(
      updateTopicReturningFull('update topics set ai_group_summary_title = $1, ai_group_summary = $2 where id = $3'),
      [payload.title, payload.summary, payload.topicId],
    );

    return TopicEditGroupSummaryResult.parse({ topic: toTopic(updated.rows[0]!) });
  },
};
