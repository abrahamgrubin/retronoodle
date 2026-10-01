import { randomUUID } from 'node:crypto';
import { SuggestionAcceptPayload, SuggestionAcceptResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { createTopicFromCardIds } from './topicHelpers.js';

/**
 * suggestion.accept (RN-017): "Accepting a suggestion creates the group for everyone." Facilitator
 * only (suggestions are never even sent to anyone else), Group phase only (suggestions can't
 * outlive it — see onTransition.ts's group->vote discard). Reuses createTopicFromCardIds, the
 * same validate-insert-update logic topic.createFromCards uses directly — if any of the
 * suggestion's cards got grouped by hand in the meantime, that call rejects with
 * `already_grouped`, which doubles as this mutation's "stale suggestion" failure mode: the
 * client's Accept button simply surfaces the error and the suggestion disappears, same as any
 * other now-irrelevant suggestion.
 */
export const suggestionAcceptMutation: MutationTypeDef<SuggestionAcceptPayload> = {
  schema: SuggestionAcceptPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.respondToSuggestion', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may respond to suggestions');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'group') {
      throw new MutationRejected(409, 'phase_not_allowed', `suggestion.accept is not allowed during ${phase}`);
    }

    const existing = await client.query<{ name: string; card_ids: string[] }>(
      "select name, card_ids from group_suggestions where id = $1 and retro_id = $2 and status = 'pending'",
      [payload.suggestionId, retro.id],
    );
    const row = existing.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'Suggestion not found or already resolved');

    const topicId = randomUUID();
    const result = await createTopicFromCardIds(client, retro.id, topicId, row.card_ids, row.name);

    await client.query("update group_suggestions set status = 'accepted' where id = $1", [payload.suggestionId]);

    return SuggestionAcceptResult.parse(result);
  },
};
