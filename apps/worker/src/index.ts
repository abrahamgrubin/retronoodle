import { PgBoss } from 'pg-boss';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';
import type { WorkerLogger } from './logger.js';
import { runGroupCardsJob } from './jobs/groupCards.js';
import { runSummarizeGroupJob } from './jobs/summarizeGroup.js';
import { runSuggestQuestionsJob } from './jobs/suggestQuestions.js';
import { runSummarizeTopicJob } from './jobs/summarizeTopic.js';

export type { WorkerLogger } from './logger.js';

export const AI_GROUP_CARDS_QUEUE = 'ai.groupCards';
// Homework: AI agent team.
export const AI_SUMMARIZE_GROUP_QUEUE = 'ai.summarizeGroup';
export const AI_SUGGEST_QUESTIONS_QUEUE = 'ai.suggestQuestions';
// RN-021: already enqueued since RN-019 (discussHelpers.ts), but never had a consumer until now.
export const AI_SUMMARIZE_TOPIC_QUEUE = 'ai.summarizeTopic';

/** The union of every job's own (narrower) RealtimeBusLike requirement — groupCards.ts only ever
 * needs broadcastUser, summarizeGroup.ts/suggestQuestions.ts only ever need broadcastRetro, but
 * whatever the caller actually passes in (the real RealtimeBus) has both, and this is the one
 * place that wires all three jobs to the same instance. */
export interface RealtimeBusLike {
  broadcastUser(userId: string, event: { type: string; payload: unknown }): Promise<void>;
  broadcastRetro(retroId: string, event: { type: string; payload: unknown }): Promise<void>;
}

export interface JobQueue {
  start(): Promise<unknown>;
  stop(options?: { graceful?: boolean }): Promise<unknown>;
  on(event: 'error', handler: (err: Error) => void): unknown;
  createQueue(name: string): Promise<unknown>;
  work<T = object>(name: string, handler: (jobs: { data: T }[]) => Promise<unknown>): Promise<string>;
}

/** RN-017: the shape `onTransition.ts`'s write->group effect enqueues `ai.groupCards` through —
 * mirrored in apps/api/src/mutations/registry.ts's own `JobSender` so neither app imports a type
 * from the other. */
export interface JobSender {
  send(queueName: string, data: object): Promise<string | null>;
}

export interface StartWorkerOptions {
  databaseUrl: string;
  logger: WorkerLogger;
  /** Injected in tests; defaults to a real pg-boss instance. */
  createQueue?: (databaseUrl: string) => JobQueue;
  /** RN-017: when present, registers the ai.groupCards handler. Absent in any environment that
   * hasn't configured Supabase/Anthropic (e.g. local dev before .env is filled in) — the worker
   * still starts and simply processes nothing for that queue, the same way the whole worker is
   * skipped when DATABASE_URL is unset (main.ts). */
  ai?: {
    supabaseAdmin: SupabaseClient<Database>;
    realtimeBus: RealtimeBusLike;
    anthropicApiKey: string | undefined;
    // RN-027: "Claude spend cap $5/month in config" — undefined means no cap is configured.
    monthlyCapUsd: number | undefined;
  };
}

export interface RunningWorker {
  queue: JobQueue;
  stop(): Promise<void>;
}

/**
 * Starts the job worker (pg-boss on Supabase Postgres, Design 2.2).
 * Job handlers: ai.groupCards (RN-017). Later stories add exports/email/retention.
 */
export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const createQueue = options.createQueue ?? ((url: string) => new PgBoss(url) as unknown as JobQueue);
  const queue = createQueue(options.databaseUrl);
  queue.on('error', (err) => options.logger.error(err, 'pg-boss error'));
  await queue.start();

  if (options.ai) {
    const { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd } = options.ai;
    await queue.createQueue(AI_GROUP_CARDS_QUEUE);
    await queue.work<{ retroId: string }>(AI_GROUP_CARDS_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await runGroupCardsJob(job.data, { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd, logger: options.logger });
      }
    });

    // Homework: AI agent team.
    await queue.createQueue(AI_SUMMARIZE_GROUP_QUEUE);
    await queue.work<{ topicId: string }>(AI_SUMMARIZE_GROUP_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await runSummarizeGroupJob(job.data, { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd, logger: options.logger });
      }
    });

    await queue.createQueue(AI_SUGGEST_QUESTIONS_QUEUE);
    await queue.work<{ topicId: string }>(AI_SUGGEST_QUESTIONS_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await runSuggestQuestionsJob(job.data, { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd, logger: options.logger });
      }
    });

    // RN-021, high priority — pg-boss processes queues independently, so this doesn't need its
    // own priority mechanism to stay responsive; it's just the one users actually wait on ("a
    // summary appears within 30s of leaving a topic").
    await queue.createQueue(AI_SUMMARIZE_TOPIC_QUEUE);
    await queue.work<{ topicId: string }>(AI_SUMMARIZE_TOPIC_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await runSummarizeTopicJob(job.data, { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd, logger: options.logger });
      }
    });
  }

  options.logger.info('worker started');

  return {
    queue,
    async stop() {
      await queue.stop({ graceful: true });
      options.logger.info('worker stopped');
    },
  };
}

/**
 * RN-017: a second, send-only pg-boss connection for the API process — the write->group
 * transition effect enqueues ai.groupCards here, never consumes from it (that's the real
 * worker's `.work()` registration above). A production deployment typically runs the API and the
 * worker as separate processes anyway; even when ROLE=all runs both in one, each gets its own
 * pg-boss connection rather than threading one instance between two independently-started
 * subsystems.
 */
export async function createJobSender(databaseUrl: string, logger: WorkerLogger): Promise<{ sender: JobSender; stop: () => Promise<void> }> {
  const boss = new PgBoss(databaseUrl);
  boss.on('error', (err) => logger.error(err, 'pg-boss error (job sender)'));
  await boss.start();
  await boss.createQueue(AI_GROUP_CARDS_QUEUE);
  await boss.createQueue(AI_SUMMARIZE_GROUP_QUEUE);
  await boss.createQueue(AI_SUGGEST_QUESTIONS_QUEUE);
  await boss.createQueue(AI_SUMMARIZE_TOPIC_QUEUE);
  return {
    sender: { send: (queueName, data) => boss.send(queueName, data) },
    async stop() {
      await boss.stop({ graceful: true });
    },
  };
}
