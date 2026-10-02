import { allowedActions, NoteUpsertPayload, NoteUpsertResult, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { toTopic, type TopicRow } from './discussHelpers.js';

/**
 * note.upsert (RN-020): "type quick notes on the current topic, so the summary captures what was
 * said even without audio." Gated by the same `summaryEdit` matrix cell as action-item editing —
 * Discuss and Wrap up only, no ownership check (the story never says "facilitator-only," unlike
 * RN-019's queue mutations, which always do — same "anyone" default as topic.rename). Debouncing
 * (800ms) is BoardPage.tsx's concern, not this mutation's — every call here is a full overwrite.
 */
export const noteUpsertMutation: MutationTypeDef<NoteUpsertPayload> = {
  schema: NoteUpsertPayload,
  async apply({ client, retro, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).summaryEdit) {
      throw new MutationRejected(409, 'phase_not_allowed', `note.upsert is not allowed during ${phase}`);
    }

    const existing = await client.query('select id from topics where id = $1 and retro_id = $2', [payload.topicId, retro.id]);
    if (existing.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Topic not found');

    const upserted = await client.query<{ body: string }>(
      `insert into topic_notes (topic_id, body) values ($1, $2)
       on conflict (topic_id) do update set body = excluded.body, updated_at = now()
       returning body`,
      [payload.topicId, payload.body],
    );

    const topic = await client.query<Omit<TopicRow, 'notes'>>(
      `select id, column_id, name, vote_count, discussion_order, started_at, ended_at,
              ai_group_summary_title, ai_group_summary, ai_discussion_questions
       from topics where id = $1`,
      [payload.topicId],
    );

    return NoteUpsertResult.parse({ topic: toTopic({ ...topic.rows[0]!, notes: upserted.rows[0]!.body }) });
  },
};
