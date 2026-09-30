import type { PoolClient } from 'pg';
import type { RetroPhase } from '@retronoodle/shared';
import type { LockedRetro } from './registry.js';

type TransitionEffect = (ctx: { client: PoolClient; retro: LockedRetro }) => Promise<void>;

/**
 * Transition side effects (Design 6.3), one row per `"from->to"` pair. RN-010 owns this table
 * and its own single row (refunding votes on the one backward transition that has any); later
 * stories add rows here rather than teaching phaseNext/phaseBack about their own side effects —
 * RN-011 (reveal cards on write->group), RN-015/17/18/19/21/23/25 add the rest.
 *
 * `votes` has one row per dot (RN-018), not a `votes_used` counter column, so "refund" is
 * deleting the rows — there's nothing else to zero out.
 */
const onTransition: Partial<Record<`${RetroPhase}->${RetroPhase}`, TransitionEffect>> = {
  'vote->group': async ({ client, retro }) => {
    await client.query('delete from votes where retro_id = $1', [retro.id]);
  },
};

export async function runTransitionEffect(client: PoolClient, retro: LockedRetro, from: RetroPhase, to: RetroPhase): Promise<void> {
  const effect = onTransition[`${from}->${to}`];
  if (effect) await effect({ client, retro });
}
