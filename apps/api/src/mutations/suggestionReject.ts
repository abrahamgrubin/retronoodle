import { SuggestionRejectPayload, SuggestionRejectResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * suggestion.reject (RN-017): "rejecting removes it." Facilitator only, Group phase only — same
 * gating as suggestion.accept. Nothing board-wide changes (no card or topic is touched), so this
 * broadcasts the same bare `{suggestionId}` to the whole team as any other mutation, but every
 * non-facilitator's board has nothing to fold from it (boardReducer.ts's own no-op case) — it
 * never meant anything to them, since suggestions are never sent to anyone but the facilitator in
 * the first place.
 */
export const suggestionRejectMutation: MutationTypeDef<SuggestionRejectPayload> = {
  schema: SuggestionRejectPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.respondToSuggestion', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may respond to suggestions');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'group') {
      throw new MutationRejected(409, 'phase_not_allowed', `suggestion.reject is not allowed during ${phase}`);
    }

    const updated = await client.query(
      "update group_suggestions set status = 'rejected' where id = $1 and retro_id = $2 and status = 'pending' returning id",
      [payload.suggestionId, retro.id],
    );
    if (updated.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Suggestion not found or already resolved');

    return SuggestionRejectResult.parse({ suggestionId: payload.suggestionId });
  },
};
