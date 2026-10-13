import { TopicRegenerateGroupSummaryPayload, TopicRegenerateGroupSummaryResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * topic.regenerateGroupSummary: re-runs the group-summarizer agent (ai.summarizeGroup,
 * best-effort enqueued here same as every other AI job in this app) — the "Retry" a facilitator
 * gets once a group summary comes back `topic.groupSummaryFailed`. This mutation only ever
 * acknowledges the request; the client shows "Summarizing…" optimistically and the real summary
 * arrives via the job's own topic.groupSummaryReady broadcast. Same facilitator/phase gates as
 * topic.editGroupSummary.
 */
export const topicRegenerateGroupSummaryMutation: MutationTypeDef<TopicRegenerateGroupSummaryPayload> = {
  schema: TopicRegenerateGroupSummaryPayload,
  async apply({ client, retro, user, payload, jobs }) {
    if (!can(user, 'retro.editAiSummary', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may regenerate a group summary');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'vote' && phase !== 'discuss') {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.regenerateGroupSummary is not allowed during ${phase}`);
    }

    const existing = await client.query('select id from topics where id = $1 and retro_id = $2', [payload.topicId, retro.id]);
    if (existing.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Topic not found');

    if (jobs) {
      try {
        await jobs.send('ai.summarizeGroup', { topicId: payload.topicId });
      } catch {
        // Swallowed deliberately, same as every other best-effort AI enqueue in this app.
      }
    }

    return TopicRegenerateGroupSummaryResult.parse({ topicId: payload.topicId });
  },
};
