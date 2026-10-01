import type { PoolClient } from 'pg';
import type { ZodType } from 'zod';
import type { HiddenBoardCard, VisibleBoardCard } from '@retronoodle/shared';
import type { AuthUser } from '../auth/index.js';

/** The row locked by `SELECT ... FOR UPDATE` for the duration of the mutation transaction. */
export interface LockedRetro {
  id: string;
  team_id: string;
  facilitator_id: string;
  phase: string;
  cards_revealed: boolean;
  phase_deadline: string | null;
}

/** RN-017: the one thing a mutation's `apply()` can do outside its own DB transaction — enqueue
 * a pg-boss job (so far, only onTransition.ts's write->group effect, for `ai.groupCards`).
 * Undefined when the process has no database to queue against (same optionality as the worker's
 * own `databaseUrl`-missing skip in main.ts) — AI grouping is best-effort, never required for a
 * phase transition to succeed. */
export interface JobSender {
  send(queueName: string, data: object): Promise<string | null>;
}

export interface MutationContext<TPayload> {
  client: PoolClient;
  retro: LockedRetro;
  user: AuthUser;
  payload: TPayload;
  jobs?: JobSender;
}

export interface MutationTypeDef<TPayload = unknown> {
  schema: ZodType<TPayload>;
  /** Runs inside the locked transaction. Throw MutationRejected to reject and roll back.
   *
   * Phase gating (RN-010, Design 6.1's `allowedActions()`) is each mutation type's own concern,
   * checked inside `apply()` rather than as a separate hook on this definition: which action row
   * of the matrix applies can depend on the target resource (e.g. card.create's column `kind` —
   * see cardCreate.ts), and `apply()` is the one place that already has the DB access to know
   * that. Reject with `MutationRejected(409, 'phase_not_allowed', ...)`. */
  apply: (ctx: MutationContext<TPayload>) => Promise<unknown>;
  /** RN-011: whether this mutation type's result is a card that might currently be hidden
   * (card.create, card.edit — see redact.ts). When true, the pipeline broadcasts a redacted
   * version to the shared `retro:{retroId}` channel and the full version to the author's own
   * `user:{id}` channel, instead of the plain single broadcast every other mutation type gets. */
  redactable?: boolean;
  /** RN-015: card.move's result isn't a bare card anymore (`{card, dissolvedTopic}`) — these let
   * pipeline.ts still find and replace the card to redact without every redactable type needing
   * them. Omitted (card.create/card.edit) means "the whole result IS the card." */
  extractCardForRedaction?: (result: unknown) => VisibleBoardCard;
  withRedactedCard?: (result: unknown, card: VisibleBoardCard | HiddenBoardCard) => unknown;
}

/**
 * Maps a mutation `type` string to its Zod schema and apply function (RN-008: "each type has a
 * Zod schema in packages/shared/mutations"). Each story that adds a mutation type registers it
 * here — apps/api/src/mutations/index.ts is where the default registry is assembled.
 */
export class MutationRegistry {
  private readonly types = new Map<string, MutationTypeDef<never>>();

  register<TPayload>(type: string, def: MutationTypeDef<TPayload>): void {
    this.types.set(type, def as unknown as MutationTypeDef<never>);
  }

  get(type: string): MutationTypeDef<never> | undefined {
    return this.types.get(type);
  }
}
