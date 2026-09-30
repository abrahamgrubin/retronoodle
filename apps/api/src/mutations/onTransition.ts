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
  // RN-011: "Reveal happens ... on write -> group". This only sets the durable flag — it
  // deliberately does NOT also broadcast every card's full content here. A second broadcast for
  // this transition would need its own retro_events row (and thus its own seq) to avoid
  // colliding with phase.next's own seq on the same channel, which phaseNext.ts's apply() has no
  // way to arrange without pipeline.ts growing a multi-event-per-mutation broadcast path. Instead,
  // the web client refetches the board once it sees the phase leave Write (BoardPage.tsx) — one
  // extra round trip, well inside the "within 500ms" acceptance criterion, and far simpler than
  // the alternative. cards.reveal (the *manual* Reveal button) has no such problem: its own
  // result already broadcasts every card as the mutation's normal, single, real event.
  'write->group': async ({ client, retro }) => {
    await client.query('update retros set cards_revealed = true where id = $1', [retro.id]);
  },
};

export async function runTransitionEffect(client: PoolClient, retro: LockedRetro, from: RetroPhase, to: RetroPhase): Promise<void> {
  const effect = onTransition[`${from}->${to}`];
  if (effect) await effect({ client, retro });
}
