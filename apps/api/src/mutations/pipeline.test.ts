import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';
import type { Pool } from 'pg';
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
