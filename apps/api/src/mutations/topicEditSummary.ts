import { TopicEditSummaryPayload, TopicEditSummaryResult, allowedActions, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { toTopicSummary, TOPIC_SUMMARY_COLUMNS, type TopicSummaryRow } from './topicSummaryHelpers.js';

/**
 * topic.editSummary (RN-021): "Edit and Regenerate buttons (facilitator only)." Overwrites the
 * latest `topic_summaries` row's four sections in place — "edits save as the final version," not
 * a new version row (that's only ever `topic.regenerateSummary`'s job, via the worker). Marks
 * `edited`; `edit_ratio` is computed later, at close (RN-023), not here.
 */
export const topicEditSummaryMutation: MutationTypeDef<TopicEditSummaryPayload> = {
  schema: TopicEditSummaryPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.editAiSummary', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may edit a topic summary');
    }
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).summaryEdit) {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.editSummary is not allowed during ${phase}`);
    }

    const existing = await client.query<{ id: string }>(
      `select ts.id
       from topic_summaries ts
       join topics t on t.id = ts.topic_id
       where ts.topic_id = $1 and t.retro_id = $2
       order by ts.version desc
       limit 1`,
      [payload.topicId, retro.id],
    );
    const row = existing.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'No summary to edit for this topic yet');

    const updated = await client.query<TopicSummaryRow>(
      `update topic_summaries
       set key_points = $1, decisions = $2, disagreements = $3, proposed_action_items = $4, edited = true
       where id = $5
       returning ${TOPIC_SUMMARY_COLUMNS}`,
      [
        JSON.stringify(payload.keyPoints),
        JSON.stringify(payload.decisions),
        JSON.stringify(payload.disagreements),
        JSON.stringify(payload.proposedActionItems),
        row.id,
      ],
    );

    return TopicEditSummaryResult.parse({ summary: toTopicSummary(updated.rows[0]!) });
  },
};
