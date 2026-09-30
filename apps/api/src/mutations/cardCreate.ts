import { generateKeyBetween } from 'fractional-indexing';
import { CardCreatePayload, CardCreateResult } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * card.create (RN-008). Position is a fractional text sort key (RN-014 will reuse the same
 * scheme for drag-and-drop): there's no GET /retros/:id/board yet for the client to know the
 * column's existing cards, so the server appends after whatever currently sorts last.
 *
 * The column-ownership check and the last-position lookup are independent reads, combined into
 * one round trip (every query here is extra latency against the 500ms end-to-end budget the
 * pipeline is built around).
 */
export const cardCreateMutation: MutationTypeDef<CardCreatePayload> = {
  schema: CardCreatePayload,
  async apply({ client, retro, user, payload }) {
    const lookup = await client.query<{ column_id: string | null; last_position: string | null }>(
      `select
         (select id from retro_columns where id = $1 and retro_id = $2) as column_id,
         (select position from cards where column_id = $1 order by position desc limit 1) as last_position`,
      [payload.columnId, retro.id],
    );
    const row = lookup.rows[0];
    if (!row?.column_id) {
      throw new MutationRejected(400, 'invalid_column', 'That column does not belong to this retro');
    }

    const position = generateKeyBetween(row.last_position, null);

    await client.query(
      'insert into cards (id, retro_id, column_id, author_id, body, position) values ($1, $2, $3, $4, $5, $6)',
      [payload.cardId, retro.id, payload.columnId, user.id, payload.body, position],
    );

    return CardCreateResult.parse({
      id: payload.cardId,
      columnId: payload.columnId,
      authorId: user.id,
      body: payload.body,
      position,
    });
  },
};
