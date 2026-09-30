import { previousPhase, PhaseTransitionPayload, PhaseTransitionResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { runTransitionEffect } from './onTransition.js';

/** `phase.back` (RN-010): only the facilitator, and only the two documented one-step-back moves
 * (Group→Write, Vote→Group — see stateMachine's `previousPhase`). Going back from Vote runs the
 * vote-refund side effect in onTransition.ts. */
export const phaseBackMutation: MutationTypeDef<PhaseTransitionPayload> = {
  schema: PhaseTransitionPayload,
  async apply({ client, retro, user }) {
    if (!can(user, 'retro.transitionPhase', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may change the phase');
    }

    const from = retro.phase as RetroPhase;
    const to = previousPhase(from);
    if (!to) throw new MutationRejected(409, 'phase_not_allowed', `Cannot go back from ${from}`);

    await runTransitionEffect(client, retro, from, to);
    await client.query('update retros set phase = $1 where id = $2', [to, retro.id]);

    return PhaseTransitionResult.parse({ phase: to });
  },
};
