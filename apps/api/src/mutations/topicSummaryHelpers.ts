import type { PoolClient } from 'pg';
import type { TopicSummary, TopicSummaryPoint } from '@retronoodle/shared';

export interface TopicSummaryRow {
  id: string;
  topic_id: string;
  version: number;
  model: string;
  prompt_version: string;
  key_points: TopicSummaryPoint[];
  decisions: TopicSummaryPoint[];
  disagreements: TopicSummaryPoint[];
  proposed_action_items: TopicSummaryPoint[];
  edited: boolean;
  edit_ratio: string | null;
  created_at: Date;
}

export function toTopicSummary(row: TopicSummaryRow): TopicSummary {
  return {
    id: row.id,
    topicId: row.topic_id,
    version: row.version,
    model: row.model,
    promptVersion: row.prompt_version,
    keyPoints: row.key_points,
    decisions: row.decisions,
    disagreements: row.disagreements,
    proposedActionItems: row.proposed_action_items,
    edited: row.edited,
    // node-postgres returns numeric columns as strings (to avoid silent float precision loss) —
    // edit_ratio is a numeric(5,4), small enough that Number() is exact here.
    editRatio: row.edit_ratio === null ? null : Number(row.edit_ratio),
    createdAt: row.created_at.toISOString(),
  };
}

const TOPIC_SUMMARY_COLUMNS =
  'id, topic_id, version, model, prompt_version, key_points, decisions, disagreements, proposed_action_items, edited, edit_ratio, created_at';

/** The one row the board ever shows for a topic — "latest" only, never a version browser. */
export async function fetchLatestTopicSummary(client: PoolClient, topicId: string): Promise<TopicSummary | null> {
  const result = await client.query<TopicSummaryRow>(
    `select ${TOPIC_SUMMARY_COLUMNS} from topic_summaries where topic_id = $1 order by version desc limit 1`,
    [topicId],
  );
  const row = result.rows[0];
  return row ? toTopicSummary(row) : null;
}

export { TOPIC_SUMMARY_COLUMNS };
