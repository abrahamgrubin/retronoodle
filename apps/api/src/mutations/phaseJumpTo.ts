import { PHASE_ORDER, PhaseJumpPayload, PhaseTransitionResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { runTransitionEffect } from './onTransition.js';
import { setPhase } from './phaseDeadline.js';

/** The header pill bar's own six phases — never `setup` (a retro is never actually sitting
 * there) or `closed` (terminal; reopening a closed retro is its own, separate decision this
 * mutation deliberately doesn't make). */
const JUMPABLE_PHASES = new Set<RetroPhase>(['review', 'write', 'group', 'vote', 'discuss', 'wrap_up']);

/**
 * phase.jumpTo: facilitator-only, clicking any phase pill in the header. Unlike phase.next/back
 * (one step, direction implied by the mutation type), the caller names an arbitrary target and
 * the server walks every phase in between — forward or backward — replaying each one's own
 * onTransition.ts side effect in order exactly as if the facilitator had clicked through one at a
 * time. This is what makes a multi-step jump safe: e.g. jumping Write→Wrap up still reveals
 * cards, auto-groups ungrouped ones, ranks topics and starts the first one, in that order, rather
 * than landing on Wrap up with nothing to discuss.
 */
export const phaseJumpToMutation: MutationTypeDef<PhaseJumpPayload> = {
  schema: PhaseJumpPayload,
  async apply({ client, retro, user, payload, jobs }) {
    if (!can(user, 'retro.transitionPhase', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may change the phase');
    }

    const from = retro.phase as RetroPhase;
    const target = payload.targetPhase;
    if (!JUMPABLE_PHASES.has(from) || !JUMPABLE_PHASES.has(target)) {
      throw new MutationRejected(409, 'phase_not_allowed', `Cannot jump between ${from} and ${target}`);
    }
    if (from === target) {
      throw new MutationRejected(409, 'phase_not_allowed', 'Already in that phase');
    }

    const fromIndex = PHASE_ORDER.indexOf(from);
    const targetIndex = PHASE_ORDER.indexOf(target);
    const step = targetIndex > fromIndex ? 1 : -1;

    let current = from;
    for (let i = fromIndex + step; ; i += step) {
      const next = PHASE_ORDER[i]!;
      await runTransitionEffect(client, retro, current, next, jobs);
      current = next;
      if (current === target) break;
    }

    const phaseDeadline = await setPhase(client, retro.id, target);
    return PhaseTransitionResult.parse({ phase: target, phaseDeadline });
  },
};
