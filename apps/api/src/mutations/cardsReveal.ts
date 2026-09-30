import { CardsRevealPayload, CardsRevealResult } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { fetchFullBoardCards } from './boardCards.js';

/** `cards.reveal` (RN-011): the facilitator clicks Reveal. Only makes sense during Write —
 * everywhere else, cards are already either not-yet-hidden (Group onward) or the phase itself
 * hasn't started hiding anything yet. Deliberately not `redactable`: the whole point of this
 * mutation is broadcasting every card in full to everyone on the shared retro:{retroId} channel. */
export const cardsRevealMutation: MutationTypeDef<CardsRevealPayload> = {
  schema: CardsRevealPayload,
  async apply({ client, retro, user }) {
    if (!can(user, 'retro.revealCards', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may reveal cards');
    }
    if (retro.phase !== 'write') {
      throw new MutationRejected(409, 'phase_not_allowed', `Cannot reveal cards during ${retro.phase}`);
    }

    await client.query('update retros set cards_revealed = true where id = $1', [retro.id]);
    const cards = await fetchFullBoardCards(client, retro.id);

    return CardsRevealResult.parse({ cards });
  },
};
