import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import type { Pool, PoolClient } from 'pg';
import type { RealtimeBus } from '../realtime/RealtimeBus.js';
import { processMutation } from './pipeline.js';
import { MutationRegistry } from './registry.js';

// A pool that throws if anything ever tries to use it — proves validation rejections never
// touch the database (they're checked before `pool.connect()`).
const poisonedPool = {
  connect: () => {
    throw new Error('pool.connect() should not be called for a request that fails validation');
  },
} as unknown as Pool;

const unusedRealtimeBus = {} as RealtimeBus;
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.com', displayName: 'A', avatarUrl: null };

function run(registry: MutationRegistry, rawBody: unknown) {
  return processMutation({
    pool: poisonedPool,
    registry,
    realtimeBus: unusedRealtimeBus,
    retroId: '00000000-0000-4000-8000-000000000002',
    user,
    rawBody,
  });
}

describe('processMutation — validation (no database touched)', () => {
  it('rejects a malformed envelope', async () => {
    const registry = new MutationRegistry();
    await expect(run(registry, { type: 'card.create' })).rejects.toBeInstanceOf(ZodError);
  });

  it('rejects an unregistered mutation type', async () => {
    const registry = new MutationRegistry();
    await expect(
      run(registry, { mutationId: '00000000-0000-4000-8000-000000000003', type: 'nonexistent.type', payload: {} }),
    ).rejects.toMatchObject({ status: 400, code: 'unknown_mutation_type' });
  });

  it("rejects a payload that fails the registered type's schema", async () => {
    const registry = new MutationRegistry();
    registry.register('test.echo', { schema: z.object({ n: z.number() }), apply: async () => null });
    await expect(
      run(registry, {
        mutationId: '00000000-0000-4000-8000-000000000003',
        type: 'test.echo',
        payload: { n: 'not a number' },
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe('processMutation — duplicate mutationId under true concurrency (RN-013)', () => {
  it('when the insert hits the unique (retro_id, mutation_id) constraint, rolls back and returns the already-committed result instead of erroring', async () => {
    const retroId = '00000000-0000-4000-8000-000000000002';
    const mutationId = '00000000-0000-4000-8000-000000000003';
    const cachedResult = { echo: 'from the request that actually won the race' };

    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    query.mockResolvedValueOnce({
      // the combined lock+membership+existing query — no existing row, this request proceeds
      rows: [
        {
          id: retroId,
          team_id: '00000000-0000-4000-8000-000000000004',
          facilitator_id: '00000000-0000-4000-8000-000000000005',
          phase: 'write',
          cards_revealed: false,
          phase_deadline: null,
          team_role: 'member',
          existing_seq: null,
          existing_payload: null,
        },
      ],
    });
    // The insert: a genuine concurrent duplicate committed first — this one loses the race.
    query.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint "retro_events_retro_id_mutation_id_key"'), {
        code: '23505',
        constraint: 'retro_events_retro_id_mutation_id_key',
      }),
    );
    query.mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    query.mockResolvedValueOnce({
      // re-querying the winner's already-committed row
      rows: [{ seq: 7, payload: { payload: {}, result: cachedResult } }],
    });

    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    const broadcastRetro = vi.fn();
    const realtimeBus = { broadcastRetro, broadcastUser: vi.fn() } as unknown as RealtimeBus;

    const registry = new MutationRegistry();
    registry.register('test.echo', { schema: z.object({}), apply: async () => ({ echo: 'from this request — should be discarded' }) });

    const outcome = await processMutation({
      pool,
      registry,
      realtimeBus,
      retroId,
      user: { id: '00000000-0000-4000-8000-000000000006', email: 'a@example.com', displayName: 'A', avatarUrl: null },
      rawBody: { mutationId, type: 'test.echo', payload: {} },
    });

    // The winner's result, not this request's own (discarded) apply() output.
    expect(outcome).toEqual({ seq: 7, result: cachedResult });
    // No duplicate broadcast — the winning request already sent the real one.
    expect(broadcastRetro).not.toHaveBeenCalled();
    // ROLLBACK ran (undoing this request's own apply() side effects), not COMMIT.
    expect(query.mock.calls.some((c) => c[0] === 'ROLLBACK')).toBe(true);
    expect(query.mock.calls.some((c) => c[0] === 'COMMIT')).toBe(false);
  });
});
