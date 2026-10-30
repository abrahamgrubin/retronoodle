import { PgBoss } from 'pg-boss';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';
import type { WorkerLogger } from './logger.js';
import { runGroupCardsJob } from './jobs/groupCards.js';
import { runSummarizeGroupJob } from './jobs/summarizeGroup.js';
import { runSuggestQuestionsJob } from './jobs/suggestQuestions.js';
import { runSummarizeTopicJob } from './jobs/summarizeTopic.js';
import { runTranscriptRetentionJob } from './jobs/transcriptRetention.js';
import { runMatchSpeakersJob } from './jobs/matchSpeakers.js';
import { runSendRetroInviteJob, type RetroInviteJob } from './jobs/sendRetroInvite.js';
import type { Notifier } from './notifier.js';

export type { WorkerLogger } from './logger.js';
// RN-033: apps/api's audio gateway persists encrypted transcript text through the same
// envelope-encryption helpers RN-031 built for the worker's own retention job — re-exported here
// since apps/worker/package.json's "exports" field is a single flat entry point
// (`{".": "./src/index.ts"}`), the only path another workspace package can import from.
export { encryptForTeam, decryptForTeam } from './transcriptKeys.js';
export { parseMasterKey } from './transcriptCrypto.js';
// RN-062: same reason — apps/api encrypts the join code into the invite job payload, and builds the
// Notifier the worker sends through, using the helpers defined here.
export { parseInvitePayloadKey, encryptJoinCode, decryptJoinCode } from './inviteCrypto.js';
export type { EncryptedPayload } from './inviteCrypto.js';
export { ResendNotifier, type Notifier, type EmailMessage } from './notifier.js';
export type { RetroInviteJob } from './jobs/sendRetroInvite.js';

export const AI_GROUP_CARDS_QUEUE = 'ai.groupCards';
// Homework: AI agent team.
export const AI_SUMMARIZE_GROUP_QUEUE = 'ai.summarizeGroup';
export const AI_SUGGEST_QUESTIONS_QUEUE = 'ai.suggestQuestions';
// RN-021: already enqueued since RN-019 (discussHelpers.ts), but never had a consumer until now.
export const AI_SUMMARIZE_TOPIC_QUEUE = 'ai.summarizeTopic';
// RN-031: nightly sweep, not per-event — registered via pg-boss's own cron scheduling
// (queue.schedule), not queue.send like every ai.* queue above.
export const TRANSCRIPT_RETENTION_QUEUE = 'transcript.retention';
// RN-036: enqueued from discussHelpers.ts's endCurrentTopic, alongside ai.summarizeTopic — a
// topic ending is also when its transcript_segments/speech_activity are complete enough to match.
export const TRANSCRIPTION_MATCH_SPEAKERS_QUEUE = 'transcription.matchSpeakers';
// RN-062: one job per invited address, enqueued by POST /retros/:id/invites.
export const EMAIL_RETRO_INVITE_QUEUE = 'email.retroInvite';
// A failed send (Resend down, rate-limited) retries with growing delay before giving up.
export const EMAIL_QUEUE_OPTIONS = { retryLimit: 5, retryDelay: 30, retryBackoff: true } as const;

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
  createQueue(name: string, options?: object): Promise<unknown>;
  work<T = object>(name: string, handler: (jobs: { data: T }[]) => Promise<unknown>): Promise<string>;
  /** RN-031: cron-scheduled recurring jobs (the nightly transcript-retention sweep), distinct
   * from the ai.* queues above which are only ever enqueued on demand via `JobSender.send`. */
  schedule(name: string, cron: string, data?: object): Promise<unknown>;
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
    // RN-037: ai.summarizeTopic's only consumer — undefined means every topic summarizes exactly
    // as if nothing was ever recorded (RN-021's own behavior), same optionality as every other
    // job here that reads it.
    transcriptMasterKey?: string;
  };
  /** RN-031: present whenever Supabase is configured — unlike `ai`, this never depends on an
   * Anthropic key, so it's its own option rather than reusing `ai`'s shape. */
  transcriptRetention?: {
    supabaseAdmin: SupabaseClient<Database>;
  };
  /** RN-036: present whenever Supabase is configured — the matching algorithm is deterministic
   * math (no AI key needed), same optionality shape as `transcriptRetention` above. */
  transcription?: {
    supabaseAdmin: SupabaseClient<Database>;
  };
  /** RN-062: present only when RESEND_API_KEY, EMAIL_FROM and INVITE_PAYLOAD_KEY are all set —
   * without them the API refuses to enqueue invites, so there is nothing to consume. */
  email?: {
    notifier: Notifier;
    inviteKey: Buffer;
    webOrigin: string;
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
    const { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd, transcriptMasterKey } = options.ai;
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
        await runSummarizeTopicJob(job.data, { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd, transcriptMasterKey, logger: options.logger });
      }
    });
  }

  if (options.transcriptRetention) {
    const { supabaseAdmin } = options.transcriptRetention;
    await queue.createQueue(TRANSCRIPT_RETENTION_QUEUE);
    await queue.work(TRANSCRIPT_RETENTION_QUEUE, async () => {
      await runTranscriptRetentionJob({ supabaseAdmin, logger: options.logger });
    });
    // 09:00 UTC — same hour as nightly-db-dump.yml's own cron, no particular reason beyond
    // "overnight for every timezone this app's single team is likely to be in."
    await queue.schedule(TRANSCRIPT_RETENTION_QUEUE, '0 9 * * *');
  }

  if (options.transcription) {
    const { supabaseAdmin } = options.transcription;
    await queue.createQueue(TRANSCRIPTION_MATCH_SPEAKERS_QUEUE);
    await queue.work<{ topicId: string }>(TRANSCRIPTION_MATCH_SPEAKERS_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await runMatchSpeakersJob(job.data, { supabaseAdmin, logger: options.logger });
      }
    });
  }

  if (options.email) {
    const { notifier, inviteKey, webOrigin } = options.email;
    await queue.createQueue(EMAIL_RETRO_INVITE_QUEUE, EMAIL_QUEUE_OPTIONS);
    await queue.work<RetroInviteJob>(EMAIL_RETRO_INVITE_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await runSendRetroInviteJob(job.data, { notifier, inviteKey, webOrigin, logger: options.logger });
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
  await boss.createQueue(TRANSCRIPTION_MATCH_SPEAKERS_QUEUE);
  await boss.createQueue(EMAIL_RETRO_INVITE_QUEUE, EMAIL_QUEUE_OPTIONS);
  return {
    sender: { send: (queueName, data) => boss.send(queueName, data) },
    async stop() {
      await boss.stop({ graceful: true });
    },
  };
}
