import { startWorker } from '@retronoodle/worker';
import { loadDotEnv, readConfig } from './config.js';
import { startProcess } from './process.js';
import { buildServer } from './server.js';

loadDotEnv();
const config = readConfig();

const log = {
  info: (msg: string) => console.log(`[${config.role}] ${msg}`),
  error: (err: unknown, msg: string) => console.error(`[${config.role}] ${msg}`, err),
};

const running = await startProcess(config.role, {
  async startApi() {
    const app = await buildServer({ webOrigin: config.webOrigin, logger: true });
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
