import { TopicRegenerateSummaryPayload, TopicRegenerateSummaryResult, allowedActions, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * topic.regenerateSummary (RN-021): re-runs the topic-summarizer agent — "each regenerate
 * creates a new version row," written later by the worker job once generation actually finishes
 * (ai.summarizeTopic, best-effort enqueued here same as every other AI job in this app). This
 * mutation only ever acknowledges the request; the client shows "Summarizing…" optimistically
 * and the real new version arrives via the job's own topic.summaryReady broadcast. "Replace your
 * edits?" is a client-side confirm before this is even sent (BoardPage.tsx) — nothing for the
 * server to enforce, since overwriting the displayed summary with a new version is exactly what
 * regenerating means.
 */
export const topicRegenerateSummaryMutation: MutationTypeDef<TopicRegenerateSummaryPayload> = {
  schema: TopicRegenerateSummaryPayload,
  async apply({ client, retro, user, payload, jobs }) {
    if (!can(user, 'retro.editAiSummary', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may regenerate a topic summary');
    }
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).summaryEdit) {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.regenerateSummary is not allowed during ${phase}`);
    }

    const existing = await client.query('select id from topics where id = $1 and retro_id = $2', [payload.topicId, retro.id]);
    if (existing.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Topic not found');

    if (jobs) {
      try {
        await jobs.send('ai.summarizeTopic', { topicId: payload.topicId });
      } catch {
        // Swallowed deliberately, same as every other best-effort AI enqueue in this app.
      }
    }

    return TopicRegenerateSummaryResult.parse({ topicId: payload.topicId });
  },
};
