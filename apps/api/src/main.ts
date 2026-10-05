import { createJobSender, startWorker } from '@retronoodle/worker';
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
    let jobSender: Awaited<ReturnType<typeof createJobSender>> | undefined;
    if (config.supabaseUrl && config.supabaseServiceRoleKey && config.databaseUrl) {
      const supabaseAdmin = createSupabaseAdmin(config.supabaseUrl, config.supabaseServiceRoleKey);
      pool = createPool(config.databaseUrl);
      // RN-017: a send-only pg-boss connection, separate from the worker's own consuming one
      // (startWorker, below) even when ROLE=all runs both in this same process — see
      // createJobSender's own comment for why. Best-effort: a failure here shouldn't stop the
      // API from starting, same as "the call failing" being graceful for ai.groupCards itself.
      try {
        jobSender = await createJobSender(config.databaseUrl, log);
      } catch (err) {
        log.error(err, 'failed to start the ai.groupCards job sender; Group will work without AI suggestions');
      }
      auth = {
        verifyAccessToken: createTokenVerifier(config.supabaseUrl),
        supabaseAdmin,
        realtimeBus: new RealtimeBus(supabaseAdmin),
        pool,
        mutationRegistry: createDefaultMutationRegistry(),
        jobs: jobSender?.sender,
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
        await jobSender?.stop();
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
    // RN-017: ai.groupCards only registers when Supabase is ALSO configured (it needs
    // supabaseAdmin to read cards/write suggestions and realtimeBus to notify the facilitator) —
    // `anthropicApiKey` itself can still be unset here; the job handles that per-call (see
    // groupCards.ts), not by skipping registration entirely, so turning on a key later doesn't
    // need a restart-with-different-config story.
    let ai: Parameters<typeof startWorker>[0]['ai'];
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      const supabaseAdmin = createSupabaseAdmin(config.supabaseUrl, config.supabaseServiceRoleKey);
      ai = {
        supabaseAdmin,
        realtimeBus: new RealtimeBus(supabaseAdmin),
        anthropicApiKey: config.anthropicApiKey,
        monthlyCapUsd: config.aiMonthlyCapUsd,
      };
    }
    return startWorker({ databaseUrl: config.databaseUrl, logger: log, ai });
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    running.stop().finally(() => process.exit(0));
  });
}
