import { PhaseExtendPayload, PhaseExtendResult } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/** `phase.extend` (RN-012): only the facilitator, +1/+2/+5 minutes. Extends from `now()`, not
 * from the stale deadline, if the timer already hit zero — extending a timer that read "-3:00"
 * by 2 minutes should land 2 minutes from now, not 1 minute further in the past. Rejects if the
 * current phase has no timer at all (phase_deadline null — setup, closed): there's nothing to
 * extend. */
export const phaseExtendMutation: MutationTypeDef<PhaseExtendPayload> = {
  schema: PhaseExtendPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.transitionPhase', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may extend the phase timer');
    }
    if (retro.phase_deadline === null) {
      throw new MutationRejected(409, 'phase_not_allowed', `${retro.phase} has no timer to extend`);
    }

    const result = await client.query<{ phase_deadline: Date }>(
      `update retros
       set phase_deadline = greatest(now(), phase_deadline) + ($1 || ' minutes')::interval
       where id = $2
       returning phase_deadline`,
      [payload.minutes, retro.id],
    );

    return PhaseExtendResult.parse({ phaseDeadline: result.rows[0]!.phase_deadline.toISOString() });
  },
};
