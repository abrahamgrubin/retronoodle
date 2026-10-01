import {
  allowedActions,
  defaultTopicName,
  TopicCreateFromCardsPayload,
  TopicCreateFromCardsResult,
  type RetroPhase,
} from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * topic.createFromCards (RN-015): "Dropping card A on card B's center creates a named group
 * containing both." Only ever grouping already-ungrouped cards (dropping onto a card that's
 * already part of a group is card.addToTopic instead — see cardAddToTopic.ts) — rejected here if
 * any of `cardIds` already has one, rather than silently moving them out of their current group.
 * Groups stay within one column ("Groups stay within one column"), so every card must share one.
 */
export const topicCreateFromCardsMutation: MutationTypeDef<TopicCreateFromCardsPayload> = {
  schema: TopicCreateFromCardsPayload,
  async apply({ client, retro, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).cardGroup) {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.createFromCards is not allowed during ${phase}`);
    }

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
      [payload.cardIds, retro.id],
    );
    if (lookup.rows.length !== payload.cardIds.length) {
      throw new MutationRejected(404, 'not_found', 'One or more cards not found');
    }
    if (new Set(lookup.rows.map((r) => r.column_id)).size > 1) {
      throw new MutationRejected(400, 'different_columns', 'Cards can only be grouped within the same column');
    }
    if (lookup.rows.some((r) => r.topic_id !== null)) {
      throw new MutationRejected(409, 'already_grouped', 'One or more cards already belong to a group');
    }

    const columnId = lookup.rows[0]!.column_id;
    const name = payload.name ?? defaultTopicName(lookup.rows[0]!.body);

    await client.query('insert into topics (id, retro_id, column_id, name) values ($1, $2, $3, $4)', [
      payload.topicId,
      retro.id,
      columnId,
      name,
    ]);
    await client.query('update cards set topic_id = $1 where id = any($2::uuid[])', [payload.topicId, payload.cardIds]);

    return TopicCreateFromCardsResult.parse({
      topic: { id: payload.topicId, columnId, name },
      cards: lookup.rows.map((r) => ({
        id: r.id,
        columnId: r.column_id,
        authorId: r.author_id,
        authorName: r.author_name,
        body: r.body,
        position: r.position,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        topicId: payload.topicId,
        // Placeholder (RN-016) — grouping never touches card_reactions, and the client preserves
        // each card's existing reactions rather than trusting this field (boardReducer.ts).
        reactions: [],
        hidden: false,
      })),
    });
  },
};
