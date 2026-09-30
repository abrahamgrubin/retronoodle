import type { PoolClient } from 'pg';
import type { ZodType } from 'zod';
import type { AuthUser } from '../auth/index.js';

/** The row locked by `SELECT ... FOR UPDATE` for the duration of the mutation transaction. */
export interface LockedRetro {
  id: string;
  team_id: string;
  facilitator_id: string;
  phase: string;
}

export interface MutationContext<TPayload> {
  client: PoolClient;
  retro: LockedRetro;
  user: AuthUser;
  payload: TPayload;
}

export interface MutationTypeDef<TPayload = unknown> {
  schema: ZodType<TPayload>;
  /** Runs inside the locked transaction. Throw MutationRejected to reject and roll back. */
  apply: (ctx: MutationContext<TPayload>) => Promise<unknown>;
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
