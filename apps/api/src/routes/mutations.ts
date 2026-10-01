import { ZodError } from 'zod';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { MutationResponse } from '@retronoodle/shared';
import type { RealtimeBus } from '../realtime/RealtimeBus.js';
import { MutationRegistry, MutationRejected, processMutation, type JobSender } from '../mutations/index.js';

export interface MutationRoutesDeps {
  pool: Pool;
  registry: MutationRegistry;
  realtimeBus: RealtimeBus;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  jobs?: JobSender;
}

/**
 * POST /retros/:id/mutations (RN-008), rate-limited to 20/s per user.
 *
 * Registered in its own encapsulated sub-plugin so the ordering is explicit and can't drift:
 * `requireAuth` is added as a preHandler hook *before* @fastify/rate-limit is registered (with
 * `hook: 'preHandler'`), and Fastify runs same-phase hooks in registration order. Get this
 * backwards and the rate limiter's keyGenerator never sees `request.user` (onRequest — the
 * plugin's default phase — runs before preHandler regardless of registration order), and it
 * silently falls back to per-IP limiting instead of per-user.
 */
export async function registerMutationRoutes(app: FastifyInstance, deps: MutationRoutesDeps): Promise<void> {
  const { pool, registry, realtimeBus, requireAuth, jobs } = deps;

  await app.register(async (instance) => {
    instance.addHook('preHandler', requireAuth);
    await instance.register(rateLimit, {
      hook: 'preHandler',
      max: 20,
      timeWindow: '1 second',
      keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
    });

    instance.post<{ Params: { id: string } }>('/retros/:id/mutations', async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      try {
        const outcome = await processMutation({
          pool,
          registry,
          realtimeBus,
          retroId: request.params.id,
          user,
          rawBody: request.body,
          jobs,
        });
        return MutationResponse.parse(outcome);
      } catch (err) {
        if (err instanceof ZodError) {
          return reply.code(400).send({ error: 'invalid_mutation', issues: err.issues });
        }
        if (err instanceof MutationRejected) {
          return reply.code(err.status).send({ error: err.code, message: err.message });
        }
        request.log.error({ err }, 'mutation pipeline failed');
        return reply.code(500).send({ error: 'mutation_failed' });
      }
    });
  });
}
