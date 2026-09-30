import { startWorker } from '@retronoodle/worker';
import { loadDotEnv, readConfig } from './config.js';
import { startProcess } from './process.js';
import { buildServer, type ServerOptions } from './server.js';
import { createTokenVerifier } from './auth.js';
import { createSupabaseAdmin } from './supabaseAdmin.js';

loadDotEnv();
const config = readConfig();

const log = {
  info: (msg: string) => console.log(`[${config.role}] ${msg}`),
  error: (err: unknown, msg: string) => console.error(`[${config.role}] ${msg}`, err),
};

const running = await startProcess(config.role, {
  async startApi() {
    let auth: ServerOptions['auth'];
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      auth = {
        verifyAccessToken: createTokenVerifier(config.supabaseUrl),
        supabaseAdmin: createSupabaseAdmin(config.supabaseUrl, config.supabaseServiceRoleKey),
      };
    } else if (config.isProduction) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to start the API.');
    } else {
      log.info('auth skipped: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set (see .env.example)');
    }

    const app = await buildServer({ webOrigin: config.webOrigin, logger: true, auth });
    await app.listen({ port: config.port, host: '0.0.0.0' });
    return { stop: () => app.close() };
  },
  async startWorker() {
    if (!config.databaseUrl) {
      // Production must have a queue; local dev can run the API before Supabase is set up.
      if (config.isProduction) throw new Error('DATABASE_URL is required to start the worker.');
      log.info('worker skipped: DATABASE_URL is not set (see .env.example)');
      return { stop: async () => {} };
    }
    return startWorker({ databaseUrl: config.databaseUrl, logger: log });
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    running.stop().finally(() => process.exit(0));
  });
}
