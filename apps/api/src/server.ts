import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { HealthResponse, MeResponse, type Database } from '@retronoodle/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { createRequireAuth, timezoneFromHeader, upsertProfile, type VerifyAccessToken } from './auth/index.js';
import { redactForLogging } from './logging/redact.js';
import { registerTeamRoutes } from './routes/teams.js';
import { registerRetroRoutes } from './routes/retros.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerMutationRoutes } from './routes/mutations.js';
import { registerBoardRoutes } from './routes/board.js';
import { registerActionItemRoutes } from './routes/actionItems.js';
import type { RealtimeBus } from './realtime/RealtimeBus.js';
import type { MutationRegistry, JobSender } from './mutations/index.js';

export interface ServerOptions {
  webOrigin: string;
  logger?: boolean;
  auth?: {
    verifyAccessToken: VerifyAccessToken;
    supabaseAdmin: SupabaseClient<Database>;
    realtimeBus: RealtimeBus;
    pool: Pool;
    mutationRegistry: MutationRegistry;
    // RN-017: enqueues ai.groupCards from the write->group transition effect. Undefined when
    // there's no queue to send to (same optionality as pool/supabaseAdmin's own "not configured"
    // case) — see onTransition.ts's best-effort handling.
    jobs?: JobSender;
  };
}

/** Builds the Fastify app. Routes from later stories register here. */
export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? {
          // RN-027: "Pino JSON logs with a redaction list" — every log call passes through this,
          // app-wide, before pino's own serializers ever see it (redact.ts's own comment explains
          // why this is safe against Fastify's own internal req/res/err logging too).
          hooks: {
            logMethod(inputArgs, method) {
              return method.apply(
                this,
                inputArgs.map((arg) => redactForLogging(arg)) as Parameters<typeof method>,
              );
            },
          },
        }
      : false,
  });

  await app.register(cors, { origin: options.webOrigin });

  // RN-027 security baseline: HSTS (helmet's own CSP default is fine here too — this is a JSON
  // API, not a page that loads scripts; the strict "no inline scripts, connect-src our domains +
  // Supabase" CSP belongs to the actual web app's pages, enforced via Cloudflare Pages' own
  // _headers file, not this server).
  await app.register(helmet, { hsts: { maxAge: 15_552_000, includeSubDomains: true } });

  // RN-027: "per-user and per-IP rate limits" baseline, applied to every route by default
  // (`global: true`) — the mutation pipeline (routes/mutations.ts) already registers its own
  // stricter, encapsulated 20/s-per-user limit on top of this for that one route; the two don't
  // conflict, they just both have to pass.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.user?.id ?? request.ip,
  });

  // RN-012: "every API response includes serverTime" — added once here rather than in each
  // route, so nothing can forget it. Object-shaped payloads only: a handful of routes (e.g. GET
  // /teams/:teamId/templates) return a bare array, and spreading a field onto an array would
  // corrupt it rather than annotate it. GET /retros/:id/board sets its own serverTime explicitly
  // (see board.ts) since the client's clock-offset calculation depends on that one specifically;
  // this hook's copy there is redundant but harmless.
  app.addHook('preSerialization', async (_request, _reply, payload: unknown) => {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return { ...payload, serverTime: new Date().toISOString() };
    }
    return payload;
  });

  app.get('/health', async (): Promise<HealthResponse> => {
    return HealthResponse.parse({ ok: true, time: new Date().toISOString() });
  });

  if (options.auth) {
    const { verifyAccessToken, supabaseAdmin, realtimeBus, pool, mutationRegistry, jobs } = options.auth;
    const requireAuth = createRequireAuth(verifyAccessToken);

    // First authenticated request upserts the caller's profile (RN-003). Later stories add
    // routes that read it back; this one both bootstraps and returns it.
    app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const { data, error } = await upsertProfile(supabaseAdmin, user, timezoneFromHeader(request.headers['x-timezone']));

      if (error || !data) {
        request.log.error({ err: error }, 'failed to upsert profile');
        return reply.code(500).send({ error: 'profile_upsert_failed' });
      }

      return MeResponse.parse({
        id: data.id,
        displayName: data.display_name,
        email: data.email,
        avatarUrl: data.avatar_url,
        timezone: data.timezone,
      });
    });

    registerTeamRoutes(app, { supabaseAdmin, requireAuth, realtimeBus });
    registerRetroRoutes(app, { supabaseAdmin, requireAuth });
    registerTemplateRoutes(app, { supabaseAdmin, requireAuth });
    registerBoardRoutes(app, { supabaseAdmin, requireAuth });
    registerActionItemRoutes(app, { supabaseAdmin, requireAuth });
    await registerMutationRoutes(app, { pool, registry: mutationRegistry, realtimeBus, requireAuth, jobs });
  }

  return app;
}
