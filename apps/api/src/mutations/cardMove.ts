import { allowedActions, CardMovePayload, CardMoveResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { dissolveIfOrphaned } from './topicHelpers.js';

/**
 * card.move (RN-014): one mutation per drop, whether it's a reorder within a column or a move to
 * another. Phase gating is `allowedActions(phase).cardDrag` — 'none' (locked), 'own' (Write: only
 * the card's author may move it — others still see the result once it broadcasts, they just
 * can't initiate the drag themselves), or 'all' (Group: anyone may move anyone's card). The
 * target column must belong to this retro and must not be the Action items column ("Cards can't
 * be dragged into the Action items column").
 *
 * RN-015: a move always places the card by position, which always leaves whatever group it was
 * in ("dropping between cards still moves rather than groups" / dragging a card out of a group
 * removes it) — so this unconditionally clears `topic_id`, and dissolves the old group if that
 * drops it to one remaining card (dissolveIfOrphaned, shared with card.addToTopic).
 */
export const cardMoveMutation: MutationTypeDef<CardMovePayload> = {
  schema: CardMovePayload,
  redactable: true,
  extractCardForRedaction: (result) => (result as CardMoveResult).card,
  withRedactedCard: (result, card) => ({ ...(result as CardMoveResult), card }),
  async apply({ client, retro, user, payload }) {
    const lookup = await client.query<{
      author_id: string;
      author_name: string;
      body: string;
      created_at: Date;
      topic_id: string | null;
      target_column_kind: string | null;
    }>(
      `with card as (
         select author_id, body, created_at, topic_id from cards where id = $1 and retro_id = $3
       ),
       target_column as (
         select kind from retro_columns where id = $2 and retro_id = $3
       )
       select card.author_id, p.display_name as author_name, card.body, card.created_at, card.topic_id,
              target_column.kind as target_column_kind
       from card
       left join target_column on true
       join profiles p on p.id = card.author_id`,
      [payload.cardId, payload.columnId, retro.id],
    );
    const row = lookup.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'Card not found');
    if (row.target_column_kind === null) {
      throw new MutationRejected(400, 'invalid_column', 'That column does not belong to this retro');
    }
    if (row.target_column_kind === 'action_items') {
      throw new MutationRejected(400, 'invalid_column', "Cards can't be dragged into the Action items column");
    }

    const phase = retro.phase as RetroPhase;
    const dragScope = allowedActions(phase).cardDrag;
    if (dragScope === 'none') {
      throw new MutationRejected(409, 'phase_not_allowed', `card.move is not allowed during ${phase}`);
    }
    if (dragScope === 'own' && !can(user, 'card.move', { type: 'card', authorId: row.author_id })) {
      throw new MutationRejected(403, 'forbidden', "Only the author may move their own card during Write");
    }

    // node-postgres parses timestamptz columns into Date objects — .toISOString() keeps this
    // result's shape consistent with BoardCard's (same note as cardCreate.ts).
    const updated = await client.query<{ updated_at: Date }>(
      'update cards set column_id = $1, position = $2, topic_id = null, updated_at = now() where id = $3 returning updated_at',
      [payload.columnId, payload.position, payload.cardId],
    );
    const { updated_at } = updated.rows[0]!;

    const dissolvedTopic = row.topic_id ? await dissolveIfOrphaned(client, row.topic_id) : null;

    return CardMoveResult.parse({
      card: {
        id: payload.cardId,
        columnId: payload.columnId,
        authorId: row.author_id,
        authorName: row.author_name,
        body: row.body,
        position: payload.position,
        createdAt: row.created_at.toISOString(),
        updatedAt: updated_at.toISOString(),
        topicId: null,
        hidden: false,
      },
      dissolvedTopic,
    });
  },
};
