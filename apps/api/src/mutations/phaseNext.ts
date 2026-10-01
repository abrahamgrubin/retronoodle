import { nextPhase, PhaseTransitionPayload, PhaseTransitionResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { runTransitionEffect } from './onTransition.js';
import { setPhase } from './phaseDeadline.js';

/**
 * `phase.next` (RN-010): only the facilitator may advance the retro. There's no `phaseCheck`
 * here — the state machine's own `nextPhase()` is the legality check, not the Design 6.1 action
 * matrix (that matrix gates participant board actions, not facilitator phase control).
 *
 * `phase.skip` registers this exact same definition (apps/api/src/mutations/index.ts): "skip"
 * and "next" resolve to the same target phase — skip is just invoked from the phase timer's Skip
 * button (RN-012) instead of the facilitator saying they're done with the phase.
 */
export const phaseNextMutation: MutationTypeDef<PhaseTransitionPayload> = {
  schema: PhaseTransitionPayload,
  async apply({ client, retro, user, jobs }) {
    if (!can(user, 'retro.transitionPhase', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may change the phase');
    }

    const from = retro.phase as RetroPhase;
    const to = nextPhase(from);
    if (!to) throw new MutationRejected(409, 'phase_not_allowed', `Cannot advance from ${from}`);

    await runTransitionEffect(client, retro, from, to, jobs);
    const phaseDeadline = await setPhase(client, retro.id, to);

    return PhaseTransitionResult.parse({ phase: to, phaseDeadline });
  },
};
