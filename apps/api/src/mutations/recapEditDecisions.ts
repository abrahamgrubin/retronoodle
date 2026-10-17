import { RecapEditDecisionsPayload, RecapEditDecisionsResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * recap.editDecisions (RN-045 follow-up): facilitator edits the recap's Decisions list. The whole
 * array is resent on every save (RecapEditDecisionsPayload's own comment on why — no stable id
 * per decision to address one in place), so the only server-side guard worth having is rejecting
 * a payload that cites a topic this retro doesn't actually have — the client only ever has real
 * topicIds to work with, so this should never trip except on a tampered request.
 */
export const recapEditDecisionsMutation: MutationTypeDef<RecapEditDecisionsPayload> = {
  schema: RecapEditDecisionsPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.editAiSummary', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may edit the recap');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'closed') {
      throw new MutationRejected(409, 'phase_not_allowed', `recap.editDecisions is not allowed during ${phase}`);
    }

    const existing = await client.query('select 1 from retro_recaps where retro_id = $1', [retro.id]);
    if (existing.rows.length === 0) throw new MutationRejected(404, 'not_found', 'No recap to edit yet');

    const topicIds = new Set(payload.decisions.map((d) => d.topicId));
    if (topicIds.size > 0) {
      const known = await client.query<{ id: string }>('select id from topics where retro_id = $1 and id = any($2)', [
        retro.id,
        [...topicIds],
      ]);
      if (known.rows.length !== topicIds.size) {
        throw new MutationRejected(400, 'invalid_topic', 'One or more decisions reference a topic outside this retro');
      }
    }

    await client.query('update retro_recaps set decisions = $1 where retro_id = $2', [
      JSON.stringify(payload.decisions),
      retro.id,
    ]);

    return RecapEditDecisionsResult.parse({ decisions: payload.decisions });
  },
};
