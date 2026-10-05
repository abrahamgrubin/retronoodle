import { PhaseTransitionResult, RetroClosePayload, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { setPhase } from './phaseDeadline.js';

/**
 * retro.close (RN-023): the only door from Wrap up to Closed — phase.next/phase.skip explicitly
 * refuse that target (phaseNext.ts) so this is never skippable. F2: closing is blocked while any
 * *active* (open/in_progress) action item from this retro has no owner, unless the facilitator
 * overrides — a `done`/`dropped` item missing an owner isn't a live commitment anymore, so it
 * doesn't count ("no commitment leaves the room ownerless"). The join link needs no extra work to
 * invalidate here: /join already rejects a closed retro's code (retros.ts), and that's driven off
 * `phase`, which this sets.
 */
export const retroCloseMutation: MutationTypeDef<RetroClosePayload> = {
  schema: RetroClosePayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.close', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may close the retro');
    }

    const phase = retro.phase as RetroPhase;
    if (phase !== 'wrap_up') {
      throw new MutationRejected(409, 'phase_not_allowed', `retro.close is not allowed during ${phase}`);
    }

    if (!payload.override) {
      const ownerless = await client.query(
        `select 1 from action_items
         where source_retro_id = $1 and status in ('open', 'in_progress') and owner_id is null
         limit 1`,
        [retro.id],
      );
      if (ownerless.rows.length > 0) {
        throw new MutationRejected(409, 'owners_missing', 'Some action items are missing an owner');
      }
    }

    const phaseDeadline = await setPhase(client, retro.id, 'closed');
    await client.query(
      `update retros set next_retro_at = $1, closed_with_override = $2, closed_at = now() where id = $3`,
      [payload.nextRetroAt, payload.override, retro.id],
    );

    return PhaseTransitionResult.parse({ phase: 'closed', phaseDeadline });
  },
};
