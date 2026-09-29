import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { HealthResponse } from '@retronoodle/shared';

export interface ServerOptions {
  webOrigin: string;
  logger?: boolean;
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

  return app;
}
