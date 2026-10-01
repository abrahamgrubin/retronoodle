import type { PoolClient } from 'pg';
import type { VisibleBoardCard } from '@retronoodle/shared';

/**
 * Shared by card.move and card.addToTopic (RN-015): both can leave a card's *previous* topic
 * with only one member, which must dissolve ("a one-card group dissolves") — deleting the topic
 * (`cards.topic_id` is `on delete set null`, so the remaining card is ungrouped for free) and
 * reporting that card back so its departure from the group can be broadcast to everyone else, not
 * just the card the caller actually dragged.
 *
 * Call this only after the card that's leaving has already had its `topic_id` changed away from
 * `oldTopicId` — the query below counts whoever's left by querying `topic_id = oldTopicId` directly,
 * so the departing card must no longer match it.
 */
export async function dissolveIfOrphaned(
  client: PoolClient,
  oldTopicId: string,
): Promise<{ topicId: string; remainingCard: VisibleBoardCard } | null> {
  const remaining = await client.query<{
    id: string;
    column_id: string;
    author_id: string;
    author_name: string;
    body: string;
    position: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `select c.id, c.column_id, c.author_id, p.display_name as author_name, c.body, c.position, c.created_at, c.updated_at
     from cards c
     join profiles p on p.id = c.author_id
     where c.topic_id = $1`,
    [oldTopicId],
  );

  if (remaining.rows.length !== 1) {
    // Either the group still has 2+ members (nothing to dissolve) or this was the last member
    // (0 left) — either way, a group with 0 or 2+ members has nothing further to report, but a
    // 0-member one still needs cleaning up since nothing else will ever delete it.
    if (remaining.rows.length === 0) await client.query('delete from topics where id = $1', [oldTopicId]);
    return null;
  }

  const row = remaining.rows[0]!;
  await client.query('delete from topics where id = $1', [oldTopicId]);
  return {
    topicId: oldTopicId,
    remainingCard: {
      id: row.id,
      columnId: row.column_id,
      authorId: row.author_id,
      authorName: row.author_name,
      body: row.body,
      position: row.position,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      topicId: null,
      // Placeholder (RN-016) — dissolving never touches card_reactions, and the client preserves
      // this card's existing reactions rather than trusting this field.
      reactions: [],
      hidden: false,
    },
  };
}
