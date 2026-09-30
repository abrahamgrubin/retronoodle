import { CardEditPayload, CardEditResult } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/** card.edit (RN-009): only the author may edit their own card. */
export const cardEditMutation: MutationTypeDef<CardEditPayload> = {
  schema: CardEditPayload,
  async apply({ client, retro, user, payload }) {
    const existing = await client.query<{ author_id: string }>(
      'select author_id from cards where id = $1 and retro_id = $2',
      [payload.cardId, retro.id],
    );
    const card = existing.rows[0];
    if (!card) throw new MutationRejected(404, 'not_found', 'Card not found');
    if (!can(user, 'card.edit', { type: 'card', authorId: card.author_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the author may edit this card');
    }

    await client.query('update cards set body = $1, updated_at = now() where id = $2', [payload.body, payload.cardId]);

    return CardEditResult.parse({ id: payload.cardId, body: payload.body });
  },
};
