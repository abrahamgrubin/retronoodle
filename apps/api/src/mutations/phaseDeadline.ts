import type { PoolClient } from 'pg';
import { phaseDurationMinutes, type RetroPhase } from '@retronoodle/shared';

/**
 * RN-012: every phase transition sets `retros.phase` and a fresh `phase_deadline` together —
 * the phase being entered gets its own default duration (stateMachine's `phaseDurationMinutes`),
 * regardless of how much of the old phase's timer was left. `nextPhase`/`previousPhase` only
 * ever return a phase with a real duration, so `minutes` is never actually null here in
 * practice — the SQL still handles it (falls back to a null deadline) so this stays correct if
 * that ever changes, rather than silently writing a bogus interval.
 */
export async function setPhase(client: PoolClient, retroId: string, to: RetroPhase): Promise<string | null> {
  const minutes = phaseDurationMinutes(to);
  const result = await client.query<{ phase_deadline: Date | null }>(
    `update retros
     set phase = $1,
         phase_deadline = case when $2::int is null then null else now() + ($2 || ' minutes')::interval end
     where id = $3
     returning phase_deadline`,
    [to, minutes, retroId],
  );
  const deadline = result.rows[0]!.phase_deadline;
  return deadline ? deadline.toISOString() : null;
}
