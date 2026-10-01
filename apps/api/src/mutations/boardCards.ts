import type { PoolClient } from 'pg';
import { VisibleBoardCard } from '@retronoodle/shared';

/** Every card in a retro, in full (RN-011) — used by `cards.reveal` and by the write->group
 * transition effect, both of which need to broadcast the real content of every currently-hidden
 * card at once. */
export async function fetchFullBoardCards(client: PoolClient, retroId: string): Promise<VisibleBoardCard[]> {
  const result = await client.query<{
    id: string;
    column_id: string;
    author_id: string;
    author_name: string;
    body: string;
    position: string;
    created_at: Date;
    updated_at: Date;
    topic_id: string | null;
  }>(
    `select c.id, c.column_id, c.author_id, p.display_name as author_name, c.body, c.position, c.created_at, c.updated_at, c.topic_id
     from cards c
     join profiles p on p.id = c.author_id
     where c.retro_id = $1`,
    [retroId],
  );
  return result.rows.map((row) =>
    VisibleBoardCard.parse({
      id: row.id,
      columnId: row.column_id,
      authorId: row.author_id,
      authorName: row.author_name,
      body: row.body,
      position: row.position,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      topicId: row.topic_id,
      hidden: false,
    }),
  );
}
