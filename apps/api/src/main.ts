import { startWorker } from '@retronoodle/worker';
import { loadDotEnv, readConfig } from './config.js';
import { startProcess } from './process.js';
import { buildServer, type ServerOptions } from './server.js';
import { createTokenVerifier } from './auth/index.js';
import { createSupabaseAdmin } from './supabaseAdmin.js';
import { RealtimeBus } from './realtime/RealtimeBus.js';
import { createPool } from './db/pool.js';
import { createDefaultMutationRegistry } from './mutations/index.js';

loadDotEnv();
const config = readConfig();

const log = {
  info: (msg: string) => console.log(`[${config.role}] ${msg}`),
  error: (err: unknown, msg: string) => console.error(`[${config.role}] ${msg}`, err),
};

const running = await startProcess(config.role, {
  async startApi() {
    let auth: ServerOptions['auth'];
    let pool: ReturnType<typeof createPool> | undefined;
    if (config.supabaseUrl && config.supabaseServiceRoleKey && config.databaseUrl) {
      const supabaseAdmin = createSupabaseAdmin(config.supabaseUrl, config.supabaseServiceRoleKey);
      pool = createPool(config.databaseUrl);
      auth = {
        verifyAccessToken: createTokenVerifier(config.supabaseUrl),
        supabaseAdmin,
        realtimeBus: new RealtimeBus(supabaseAdmin),
        pool,
        mutationRegistry: createDefaultMutationRegistry(),
      };
    } else if (config.isProduction) {
      throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL are required to start the API.');
    } else {
      log.info('auth skipped: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/DATABASE_URL not all set (see .env.example)');
    }

    const app = await buildServer({ webOrigin: config.webOrigin, logger: true, auth });
    await app.listen({ port: config.port, host: '0.0.0.0' });
    return {
      stop: async () => {
        await app.close();
        await pool?.end();
      },
    };
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
