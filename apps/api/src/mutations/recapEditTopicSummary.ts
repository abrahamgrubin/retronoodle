import { RecapEditTopicSummaryPayload, RecapEditTopicSummaryResult, RecapTopicSummary, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * recap.editTopicSummary (RN-045 follow-up): facilitator edits one topic's recap summary text in
 * place — "edits save as the final version," same precedent as topic.editSummary, just against
 * retro_recaps' own stored topic_summaries array (one entry per discussed topic) instead of the
 * topic_summaries table. Gated to `closed` specifically, same as recap.regenerate — the recap
 * isn't part of the Design 6.1 phase matrix at all.
 */
export const recapEditTopicSummaryMutation: MutationTypeDef<RecapEditTopicSummaryPayload> = {
  schema: RecapEditTopicSummaryPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.editAiSummary', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may edit the recap');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'closed') {
      throw new MutationRejected(409, 'phase_not_allowed', `recap.editTopicSummary is not allowed during ${phase}`);
    }

    const existing = await client.query<{ topic_summaries: unknown }>(
      'select topic_summaries from retro_recaps where retro_id = $1',
      [retro.id],
    );
    const row = existing.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'No recap to edit yet');

    const topicSummaries = RecapTopicSummary.array().parse(row.topic_summaries);
    const index = topicSummaries.findIndex((s) => s.topicId === payload.topicId);
    if (index === -1) throw new MutationRejected(404, 'not_found', 'No summary for this topic in the recap');

    topicSummaries[index] = { ...topicSummaries[index]!, summary: payload.summary };

    await client.query('update retro_recaps set topic_summaries = $1 where retro_id = $2', [
      JSON.stringify(topicSummaries),
      retro.id,
    ]);

    return RecapEditTopicSummaryResult.parse({ topicSummaries });
  },
};
