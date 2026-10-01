import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { MutationEnvelope, type RetroPhase, type VisibleBoardCard } from '@retronoodle/shared';
import type { AuthUser } from '../auth/index.js';
import { can, type TeamRole } from '../auth/can.js';
import type { RealtimeBus } from '../realtime/RealtimeBus.js';
import { isCardCurrentlyHidden, toHiddenCard } from '../realtime/redact.js';
import type { MutationRegistry, LockedRetro } from './registry.js';
import { MutationRejected } from './errors.js';

export interface MutationOutcome {
  seq: number;
  result: unknown;
}

interface StoredEventPayload {
  payload: unknown;
  result: unknown;
}

interface LockAndCheckRow {
  id: string;
  team_id: string;
  facilitator_id: string;
  phase: string;
  cards_revealed: boolean;
  phase_deadline: Date | null;
  team_role: TeamRole | null;
  existing_seq: number | null;
  existing_payload: StoredEventPayload | null;
}

/** Postgres error code for a unique-constraint violation (node-postgres's DatabaseError exposes
 * this as `.code`, per https://www.postgresql.org/docs/current/errcodes-appendix.html). */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/**
 * POST /retros/:id/mutations, in one transaction (RN-008):
 *   SELECT ... FOR UPDATE on the retro row -> check can() -> apply (which checks phase gating
 *   itself, RN-010's Design 6.1 action matrix — see registry.ts's MutationTypeDef.apply comment)
 *   -> seq = last + 1 -> insert retro_events -> commit -> broadcast (redacted via RN-011's
 *   redact.ts for any mutation type marked `redactable`, full otherwise).
 *
 * The FOR UPDATE lock is what makes seq assignment gapless under concurrency: every mutation for
 * a given retro serializes through that one row lock, so no two transactions ever compute the
 * same "next seq", and a rolled-back mutation simply never consumes one.
 *
 * The upfront `existing` lookup (combined into the same query as the lock, below) is only an
 * *optimization* for the common case — replaying an already-committed mutationId without
 * re-running `apply()`'s side effects. It is NOT sufficient on its own to guarantee idempotency
 * under true concurrency (RN-013 found this live): two requests for the same mutationId, both
 * blocked on the `for update` wait, both resume once the first commits and releases the lock —
 * but under READ COMMITTED, Postgres's EvalPlanQual re-check on a lock wait only re-fetches the
 * *locked* row (`retros`); the `existing` CTE reads a different table (`retro_events`) using the
 * statement's original snapshot, so the second request can still see "no existing row" and go
 * ahead and call `apply()` again. The real idempotency guarantee is a unique constraint —
 * `retro_events`'s own `(retro_id, mutation_id)`, but just as often one `apply()` hits on its own
 * first (e.g. `cards.id`: the client reuses the same card id across a retry exactly like it
 * reuses the mutationId, so a concurrent duplicate send collides on `cards_pkey` before ever
 * reaching the retro_events insert — found live, see pipeline.test.ts). Either way the fix is the
 * same: catch *any* unique-violation from `apply()` or the insert, roll back this request's own
 * (duplicate) side effects, and check whether a retro_events row for this exact mutationId now
 * exists — if so, some concurrent request already won the race, so return its cached result
 * instead of erroring; if not, this was a genuinely different conflict and the error is real.
 *
 * Every extra round trip here is pure network latency against a remote Postgres (RN-008's own
 * acceptance criterion is a 500ms end-to-end budget), so the lock, the idempotency check and the
 * caller's team role are combined into one query with CTEs, and so are the seq assignment and
 * the event insert — down from 8 round trips to 5 (4 here + however many `apply()` itself uses).
 * The role lookup reads team_members directly instead of going through getTeamRole()'s
 * supabase-js call: this connection already bypasses RLS the same way service_role does, so
 * there's no need for a second, separate network hop to PostgREST just for this one read.
 */
export async function processMutation(deps: {
  pool: Pool;
  registry: MutationRegistry;
  realtimeBus: RealtimeBus;
  retroId: string;
  user: AuthUser;
  rawBody: unknown;
}): Promise<MutationOutcome> {
  const { pool, registry, realtimeBus, retroId, user, rawBody } = deps;

  const envelope = MutationEnvelope.parse(rawBody);
  const def = registry.get(envelope.type);
  if (!def) {
    throw new MutationRejected(400, 'unknown_mutation_type', `Unknown mutation type "${envelope.type}"`);
  }
  const payload = def.schema.parse(envelope.payload);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const lockResult = await client.query<LockAndCheckRow>(
        `with locked as (
           select id, team_id, facilitator_id, phase, cards_revealed, phase_deadline
           from retros
           where id = $1
           for update
         ),
         membership as (
           select role from team_members where team_id = (select team_id from locked) and user_id = $3
         ),
         existing as (
           select seq, payload from retro_events where retro_id = $1 and mutation_id = $2
         )
         select locked.*, membership.role as team_role, existing.seq as existing_seq, existing.payload as existing_payload
         from locked
         left join membership on true
         left join existing on true`,
        [retroId, envelope.mutationId, user.id],
      );
      const row = lockResult.rows[0];
      if (!row) throw new MutationRejected(404, 'not_found', 'Retro not found');

      if (row.existing_seq !== null) {
        await client.query('COMMIT');
        return { seq: row.existing_seq, result: row.existing_payload!.result };
      }

      const retro: LockedRetro = {
        id: row.id,
        team_id: row.team_id,
        facilitator_id: row.facilitator_id,
        phase: row.phase,
        cards_revealed: row.cards_revealed,
        // node-postgres parses timestamptz into a Date, not a string (same note as cardCreate.ts).
        phase_deadline: row.phase_deadline ? row.phase_deadline.toISOString() : null,
      };
      if (!can(user, 'retro.mutate', { type: 'retro', teamRole: row.team_role, facilitatorId: retro.facilitator_id })) {
        throw new MutationRejected(403, 'forbidden', 'Not allowed to mutate this retro');
      }

      let applyResult: unknown;
      let seq: number;
      try {
        applyResult = await def.apply({ client, retro, user, payload });

        const storedPayload: StoredEventPayload = { payload, result: applyResult };
        const insertResult = await client.query<{ seq: number }>(
          `with next_seq as (
             select coalesce(max(seq), 0) + 1 as seq from retro_events where retro_id = $1
           )
           insert into retro_events (id, retro_id, seq, mutation_id, type, payload, actor_id)
           select $2, $1, next_seq.seq, $3, $4, $5::jsonb, $6 from next_seq
           returning seq`,
          [retroId, randomUUID(), envelope.mutationId, envelope.type, JSON.stringify(storedPayload), user.id],
        );
        seq = insertResult.rows[0]!.seq;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // A true concurrent duplicate (see the function doc comment above): this request's own
        // side effects (whichever of apply()'s writes or the retro_events insert actually hit
        // the collision) need to be discarded before returning the winning request's result.
        await client.query('ROLLBACK');
        const existing = await client.query<{ seq: number; payload: StoredEventPayload }>(
          'select seq, payload from retro_events where retro_id = $1 and mutation_id = $2',
          [retroId, envelope.mutationId],
        );
        const existingRow = existing.rows[0];
        if (!existingRow) throw err; // a genuinely different conflict — don't swallow the real error
        return { seq: existingRow.seq, result: existingRow.payload.result };
      }

      await client.query('COMMIT');

      // Outside the transaction: a failed broadcast shouldn't roll back an already-committed
      // mutation — the event is durably stored either way and reconnect/replay can catch up.
      //
      // RN-011: a redactable result (card.create/card.edit) might currently be hidden — the
      // shared retro:{retroId} channel (no single recipient) only ever gets the redacted shape
      // then, while the full card goes out separately on the author's private user:{id} channel
      // so their other open tabs still see real text (the author is always ctx.user here: only
      // the author may create or edit their own card).
      if (def.redactable && isCardCurrentlyHidden({ phase: retro.phase as RetroPhase, cardsRevealed: retro.cards_revealed })) {
        // RN-015: most redactable results ARE the card (card.create/card.edit); card.move's
        // isn't (`{card, dissolvedTopic}`), so it supplies extractCardForRedaction/
        // withRedactedCard to find and replace the card within its own composite shape.
        const card = def.extractCardForRedaction ? def.extractCardForRedaction(applyResult) : (applyResult as VisibleBoardCard);
        const hiddenCard = toHiddenCard(card);
        const hiddenResult = def.withRedactedCard ? def.withRedactedCard(applyResult, hiddenCard) : hiddenCard;
        await realtimeBus.broadcastRetro(retroId, { type: envelope.type, payload: { seq, result: hiddenResult } });
        await realtimeBus.broadcastUser(user.id, { type: envelope.type, payload: { seq, result: applyResult } });
      } else {
        await realtimeBus.broadcastRetro(retroId, { type: envelope.type, payload: { seq, result: applyResult } });
      }

      return { seq, result: applyResult };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}
