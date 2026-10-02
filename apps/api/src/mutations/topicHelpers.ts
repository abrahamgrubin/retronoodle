import type { PoolClient } from 'pg';
import { defaultTopicName, type TopicCreateFromCardsResult, type VisibleBoardCard } from '@retronoodle/shared';
import { MutationRejected } from './errors.js';

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

/**
 * Shared by topic.createFromCards (RN-015, a direct drop-onto-a-card's-center) and
 * suggestion.accept (RN-017, a facilitator accepting an AI-suggested group) — both end up doing
 * exactly this: validate a set of card ids (found, same column, none already grouped), insert the
 * topic, and point every card at it. Only how `cardIds`/`name` are sourced differs between the
 * two callers.
 */
export async function createTopicFromCardIds(
  client: PoolClient,
  retroId: string,
  topicId: string,
  cardIds: string[],
  explicitName: string | undefined,
): Promise<TopicCreateFromCardsResult> {
  const lookup = await client.query<{
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
     where c.id = any($1::uuid[]) and c.retro_id = $2`,
    [cardIds, retroId],
  );
  if (lookup.rows.length !== cardIds.length) {
    throw new MutationRejected(404, 'not_found', 'One or more cards not found');
  }
  if (new Set(lookup.rows.map((r) => r.column_id)).size > 1) {
    throw new MutationRejected(400, 'different_columns', 'Cards can only be grouped within the same column');
  }
  if (lookup.rows.some((r) => r.topic_id !== null)) {
    throw new MutationRejected(409, 'already_grouped', 'One or more cards already belong to a group');
  }

  const columnId = lookup.rows[0]!.column_id;
  const name = explicitName ?? defaultTopicName(lookup.rows[0]!.body);

  await client.query('insert into topics (id, retro_id, column_id, name) values ($1, $2, $3, $4)', [topicId, retroId, columnId, name]);
  await client.query('update cards set topic_id = $1 where id = any($2::uuid[])', [topicId, cardIds]);

  return {
    // A freshly created topic has no votes yet — voting hasn't started (Group phase only), and
    // RN-019's discuss-queue fields are always null this early (they're only ever set starting
    // at the vote->discuss transition, long after grouping is done). Same for the homework AI
    // fields — group-summarizer/question-suggester only ever run starting at group->vote onward.
    topic: {
      id: topicId,
      columnId,
      name,
      voteCount: 0,
      discussionOrder: null,
      startedAt: null,
      endedAt: null,
      groupSummaryTitle: null,
      groupSummary: null,
      discussionQuestions: null,
      // RN-020: notes are editable Discuss/Wrap-up onward only — a topic can't have any yet.
      notes: '',
    },
    cards: lookup.rows.map((r) => ({
      id: r.id,
      columnId: r.column_id,
      authorId: r.author_id,
      authorName: r.author_name,
      body: r.body,
      position: r.position,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      topicId,
      // Placeholder (RN-016) — grouping never touches card_reactions, and the client preserves
      // each card's existing reactions rather than trusting this field (boardReducer.ts).
      reactions: [],
      hidden: false,
    })),
  };
}
