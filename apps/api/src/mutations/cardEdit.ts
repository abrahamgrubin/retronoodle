import { allowedActions, CardEditPayload, CardEditResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/** card.edit (RN-009): only the author may edit their own card. Phase gating (RN-010) depends on
 * the card's column `kind` — see cardCreate.ts's comment on why this can't be a plain
 * `phaseCheck: (phase) => boolean`. Returns the full card, not just `{id, body}` (RN-011: redact()
 * needs the whole shape to build a hidden broadcast if the card is currently hidden). */
export const cardEditMutation: MutationTypeDef<CardEditPayload> = {
  schema: CardEditPayload,
  redactable: true,
  async apply({ client, retro, user, payload }) {
    const existing = await client.query<{
      author_id: string;
      author_name: string;
      column_id: string;
      column_kind: string;
      position: string;
      created_at: Date;
    }>(
      `select c.author_id, p.display_name as author_name, c.column_id, rc.kind as column_kind, c.position, c.created_at
       from cards c
       join retro_columns rc on rc.id = c.column_id
       join profiles p on p.id = c.author_id
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

    // node-postgres parses timestamptz columns into Date objects — .toISOString() keeps this
    // result's shape consistent with BoardCard's (same note as cardCreate.ts).
    const updated = await client.query<{ updated_at: Date }>(
      'update cards set body = $1, updated_at = now() where id = $2 returning updated_at',
      [payload.body, payload.cardId],
    );
    const { updated_at } = updated.rows[0]!;

    return CardEditResult.parse({
      id: payload.cardId,
      columnId: card.column_id,
      authorId: card.author_id,
      authorName: card.author_name,
      body: payload.body,
      position: card.position,
      createdAt: card.created_at.toISOString(),
      updatedAt: updated_at.toISOString(),
      hidden: false,
    });
  },
};
