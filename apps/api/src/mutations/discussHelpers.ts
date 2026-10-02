import type { PoolClient } from 'pg';
import type { Topic } from '@retronoodle/shared';
import type { JobSender } from './registry.js';

export interface TopicRow {
  id: string;
  column_id: string;
  name: string;
  vote_count: number;
  discussion_order: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  ai_group_summary_title: string | null;
  ai_group_summary: string | null;
  ai_discussion_questions: string[] | null;
  notes: string;
}

const TOPIC_RETURNING_COLUMNS =
  'id, column_id, name, vote_count, discussion_order, started_at, ended_at, ' +
  'ai_group_summary_title, ai_group_summary, ai_discussion_questions';

/**
 * Wraps an `update topics set ... where ...` statement (no `returning` clause of its own) so the
 * result also carries the topic's real, current notes — RN-020's `topic_notes` is a separate
 * table, one row per topic, not a column on `topics` itself. Without this, a mutation that
 * updates some other part of a topic (ending it, reordering it, editing its AI summary) would
 * have nothing to say about notes at all, and hardcoding `notes: ''` into its result would
 * silently wipe out a facilitator's typed notes from every other client's view the moment that
 * unrelated mutation broadcasts (`upsertTopic` on the client replaces the whole topic object).
 * One atomic query via a CTE, not a second round-trip that could race the first.
 */
export function updateTopicReturningFull(updateSql: string): string {
  return `with updated as (
      ${updateSql} returning ${TOPIC_RETURNING_COLUMNS}
    )
    select updated.*, coalesce(tn.body, '') as notes
    from updated
    left join topic_notes tn on tn.topic_id = updated.id`;
}

export function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    columnId: row.column_id,
    name: row.name,
    voteCount: row.vote_count,
    discussionOrder: row.discussion_order,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    groupSummaryTitle: row.ai_group_summary_title,
    groupSummary: row.ai_group_summary,
    discussionQuestions: row.ai_discussion_questions,
    notes: row.notes,
  };
}

/**
 * Ends whichever topic is current for this retro (`started_at` set, `ended_at` still null) —
 * there's never more than one, since topic.next/topic.setCurrent always end the old one before
 * starting a new one. Best-effort enqueues its summary (RN-021 builds the worker side that
 * actually consumes `ai.summarizeTopic`; this just leaves the job for it, same "never block on
 * AI" precedent as write->group's ai.groupCards in onTransition.ts). Returns the ended topic, or
 * null if nothing was current.
 */
export async function endCurrentTopic(client: PoolClient, retroId: string, jobs?: JobSender): Promise<Topic | null> {
  const current = await client.query<TopicRow>(
    `select t.id, t.column_id, t.name, t.vote_count, t.discussion_order, t.started_at, t.ended_at,
            t.ai_group_summary_title, t.ai_group_summary, t.ai_discussion_questions,
            coalesce(tn.body, '') as notes
     from topics t
     left join topic_notes tn on tn.topic_id = t.id
     where t.retro_id = $1 and t.started_at is not null and t.ended_at is null`,
    [retroId],
  );
  const row = current.rows[0];
  if (!row) return null;

  const ended = await client.query<TopicRow>(updateTopicReturningFull('update topics set ended_at = now() where id = $1'), [row.id]);

  if (jobs) {
    try {
      await jobs.send('ai.summarizeTopic', { topicId: row.id });
    } catch {
      // Swallowed deliberately — see above.
    }
  }

  return toTopic(ended.rows[0]!);
}

/**
 * (Re)starts a specific topic. "Jump when needed" (the story's own framing) has no stated limit
 * to never-discussed topics — revisiting one already discussed simply reopens it by clearing
 * `ended_at` again. Homework: also best-effort enqueues question-suggester, which writes its
 * questions the moment a topic becomes current — same "never block on AI" precedent as
 * endCurrentTopic's own ai.summarizeTopic enqueue above.
 */
export async function startTopic(client: PoolClient, topicId: string, jobs?: JobSender): Promise<Topic> {
  const started = await client.query<TopicRow>(
    updateTopicReturningFull('update topics set started_at = now(), ended_at = null where id = $1'),
    [topicId],
  );

  if (jobs) {
    try {
      await jobs.send('ai.suggestQuestions', { topicId });
    } catch {
      // Swallowed deliberately — see above.
    }
  }

  return toTopic(started.rows[0]!);
}
