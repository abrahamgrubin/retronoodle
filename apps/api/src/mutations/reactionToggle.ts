import { allowedActions, ReactionTogglePayload, ReactionToggleResult, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * reaction.toggle (RN-016): allowed on any revealed card, including Action items cards — unlike
 * cardCrud/actionItemEdit there's no column-kind branching, reacting isn't an editing action.
 * Phase gating is stateMachine's own `cardReact` scope: 'never' (Review, Vote) rejects outright,
 * 'after_reveal' (Write) additionally requires `cards_revealed` ("Never on hidden cards"),
 * 'always' (Group, Discuss, Wrap up) needs nothing further. No ownership check — "anyone can
 * react to anyone's card" once it's visible.
 *
 * The emoji itself is constrained to the fixed quick-set at the schema level (Emoji, in
 * reactions.ts), so there's no separate validation for it here.
 */
export const reactionToggleMutation: MutationTypeDef<ReactionTogglePayload> = {
  schema: ReactionTogglePayload,
  async apply({ client, retro, user, payload }) {
    const exists = await client.query('select 1 from cards where id = $1 and retro_id = $2', [payload.cardId, retro.id]);
    if (exists.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Card not found');

    const phase = retro.phase as RetroPhase;
    const scope = allowedActions(phase).cardReact;
    if (scope === 'never') {
      throw new MutationRejected(409, 'phase_not_allowed', `reaction.toggle is not allowed during ${phase}`);
    }
    if (scope === 'after_reveal' && !retro.cards_revealed) {
      throw new MutationRejected(409, 'phase_not_allowed', 'Cards must be revealed before reacting');
    }

    const existing = await client.query('select 1 from card_reactions where card_id = $1 and user_id = $2 and emoji = $3', [
      payload.cardId,
      user.id,
      payload.emoji,
    ]);
    const added = existing.rows.length === 0;
    if (added) {
      await client.query('insert into card_reactions (card_id, user_id, emoji) values ($1, $2, $3)', [
        payload.cardId,
        user.id,
        payload.emoji,
      ]);
    } else {
      await client.query('delete from card_reactions where card_id = $1 and user_id = $2 and emoji = $3', [
        payload.cardId,
        user.id,
        payload.emoji,
      ]);
    }

    return ReactionToggleResult.parse({ cardId: payload.cardId, userId: user.id, emoji: payload.emoji, added });
  },
};
