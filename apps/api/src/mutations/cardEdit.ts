import { allowedActions, CardEditPayload, CardEditResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/** card.edit (RN-009): only the author may edit their own card. Phase gating (RN-010) depends on
 * the card's column `kind` — see cardCreate.ts's comment on why this can't be a plain
 * `phaseCheck: (phase) => boolean`. */
export const cardEditMutation: MutationTypeDef<CardEditPayload> = {
  schema: CardEditPayload,
  async apply({ client, retro, user, payload }) {
    const existing = await client.query<{ author_id: string; column_kind: string }>(
      `select c.author_id, rc.kind as column_kind
       from cards c
       join retro_columns rc on rc.id = c.column_id
       where c.id = $1 and c.retro_id = $2`,
      [payload.cardId, retro.id],
    );
    const card = existing.rows[0];
    if (!card) throw new MutationRejected(404, 'not_found', 'Card not found');
    if (!can(user, 'card.edit', { type: 'card', authorId: card.author_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the author may edit this card');
    }

    const phase = retro.phase as RetroPhase;
    const allowed = card.column_kind === 'action_items' ? allowedActions(phase).actionItemEdit : allowedActions(phase).cardCrud;
    if (!allowed) {
      throw new MutationRejected(409, 'phase_not_allowed', `card.edit is not allowed during ${phase}`);
    }

    await client.query('update cards set body = $1, updated_at = now() where id = $2', [payload.body, payload.cardId]);

    return CardEditResult.parse({ id: payload.cardId, body: payload.body });
  },
};
