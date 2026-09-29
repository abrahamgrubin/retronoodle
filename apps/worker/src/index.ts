import { PgBoss } from 'pg-boss';

export interface WorkerLogger {
  info(msg: string): void;
  error(obj: unknown, msg: string): void;
}

export interface JobQueue {
  start(): Promise<unknown>;
  stop(options?: { graceful?: boolean }): Promise<unknown>;
  on(event: 'error', handler: (err: Error) => void): unknown;
}

export interface StartWorkerOptions {
  databaseUrl: string;
  logger: WorkerLogger;
  /** Injected in tests; defaults to a real pg-boss instance. */
  createQueue?: (databaseUrl: string) => JobQueue;
}

export interface RunningWorker {
  queue: JobQueue;
  stop(): Promise<void>;
}

/**
 * Starts the job worker (pg-boss on Supabase Postgres, Design 2.2).
 * Job handlers (AI, exports, email, retention) are registered by later stories.
 */
export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const createQueue = options.createQueue ?? ((url: string) => new PgBoss(url));
  const queue = createQueue(options.databaseUrl);
  queue.on('error', (err) => options.logger.error(err, 'pg-boss error'));
  await queue.start();
  options.logger.info('worker started');

  return {
    queue,
    async stop() {
      await queue.stop({ graceful: true });
      options.logger.info('worker stopped');
    },
  };
}
