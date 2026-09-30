import { CardDeletePayload, CardDeleteResult } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/** card.delete (RN-009): only the author may delete their own card. */
export const cardDeleteMutation: MutationTypeDef<CardDeletePayload> = {
  schema: CardDeletePayload,
  async apply({ client, retro, user, payload }) {
    const existing = await client.query<{ author_id: string }>(
      'select author_id from cards where id = $1 and retro_id = $2',
      [payload.cardId, retro.id],
    );
    const card = existing.rows[0];
    if (!card) throw new MutationRejected(404, 'not_found', 'Card not found');
    if (!can(user, 'card.delete', { type: 'card', authorId: card.author_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the author may delete this card');
    }

    await client.query('delete from cards where id = $1', [payload.cardId]);

    return CardDeleteResult.parse({ id: payload.cardId });
  },
};
