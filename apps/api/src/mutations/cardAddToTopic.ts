import { allowedActions, CardAddToTopicPayload, CardAddToTopicResult, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { dissolveIfOrphaned } from './topicHelpers.js';

/**
 * card.addToTopic (RN-015): dropping a card onto one that's already grouped, or picking an
 * already-grouped card from the "Group with…" menu. The target topic and the card must be in the
 * same column (groups stay within one column) — joining can itself dissolve the card's *previous*
 * group the same way card.move can (dissolveIfOrphaned), since joining a different group is still
 * a departure from whichever one it was in before.
 */
export const cardAddToTopicMutation: MutationTypeDef<CardAddToTopicPayload> = {
  schema: CardAddToTopicPayload,
  async apply({ client, retro, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).cardGroup) {
      throw new MutationRejected(409, 'phase_not_allowed', `card.addToTopic is not allowed during ${phase}`);
    }

    const lookup = await client.query<{
      card_column_id: string;
      author_id: string;
      author_name: string;
      body: string;
      position: string;
      created_at: Date;
      updated_at: Date;
      old_topic_id: string | null;
      topic_column_id: string | null;
      topic_name: string | null;
    }>(
      `with card as (
         select column_id, author_id, body, position, created_at, updated_at, topic_id from cards where id = $1 and retro_id = $3
       ),
       topic as (
         select column_id, name from topics where id = $2 and retro_id = $3
       )
       select card.column_id as card_column_id, p.display_name as author_name, card.author_id, card.body, card.position,
              card.created_at, card.updated_at, card.topic_id as old_topic_id,
              topic.column_id as topic_column_id, topic.name as topic_name
       from card
       left join topic on true
       join profiles p on p.id = card.author_id`,
      [payload.cardId, payload.topicId, retro.id],
    );
    const row = lookup.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'Card not found');
    if (row.topic_column_id === null) throw new MutationRejected(404, 'not_found', 'Topic not found');
    if (row.topic_column_id !== row.card_column_id) {
      throw new MutationRejected(400, 'wrong_column', 'A card can only join a group in its own column');
    }

    await client.query('update cards set topic_id = $1 where id = $2', [payload.topicId, payload.cardId]);

    const dissolvedTopic =
      row.old_topic_id && row.old_topic_id !== payload.topicId ? await dissolveIfOrphaned(client, row.old_topic_id) : null;

    return CardAddToTopicResult.parse({
      topic: { id: payload.topicId, columnId: row.topic_column_id, name: row.topic_name },
      card: {
        id: payload.cardId,
        columnId: row.card_column_id,
        authorId: row.author_id,
        authorName: row.author_name,
        body: row.body,
        position: row.position,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        topicId: payload.topicId,
        hidden: false,
      },
      dissolvedTopic,
    });
  },
};
