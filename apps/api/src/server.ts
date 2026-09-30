import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { HealthResponse, MeResponse, type Database } from '@retronoodle/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRequireAuth, type VerifyAccessToken } from './auth/index.js';
import { registerTeamRoutes } from './routes/teams.js';
import type { RealtimeBus } from './realtime/RealtimeBus.js';

export interface ServerOptions {
  webOrigin: string;
  logger?: boolean;
  auth?: {
    verifyAccessToken: VerifyAccessToken;
    supabaseAdmin: SupabaseClient<Database>;
    realtimeBus: RealtimeBus;
  };
}

/** Builds the Fastify app. Routes from later stories register here. */
export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  await app.register(cors, { origin: options.webOrigin });

  app.get('/health', async (): Promise<HealthResponse> => {
    return HealthResponse.parse({ ok: true, time: new Date().toISOString() });
  });

  if (options.auth) {
    const { verifyAccessToken, supabaseAdmin, realtimeBus } = options.auth;
    const requireAuth = createRequireAuth(verifyAccessToken);

    // First authenticated request upserts the caller's profile (RN-003). Later stories add
    // routes that read it back; this one both bootstraps and returns it.
    app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const timezoneHeader = request.headers['x-timezone'];
      const timezone = typeof timezoneHeader === 'string' && timezoneHeader.length > 0 ? timezoneHeader : 'UTC';

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .upsert(
          {
            id: user.id,
            display_name: user.displayName,
            email: user.email,
            avatar_url: user.avatarUrl,
            timezone,
          },
          { onConflict: 'id' },
        )
        .select()
        .single();

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
  }

  return app;
}
