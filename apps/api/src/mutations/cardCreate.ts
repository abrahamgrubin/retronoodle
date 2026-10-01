import { generateKeyBetween } from 'fractional-indexing';
import { allowedActions, CardCreatePayload, CardCreateResult, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * card.create (RN-008, extended by RN-009). Position is a fractional text sort key (RN-014 will
 * reuse the same scheme for drag-and-drop) — appends after whatever currently sorts last in the
 * column, since there's no per-client ordering state to insert relative to on create.
 *
 * The column-ownership check and the last-position lookup are independent reads, combined into
 * one round trip (every query here is extra latency against the 500ms end-to-end budget the
 * pipeline is built around).
 *
 * Phase gating (RN-010) depends on which column this is — the Action items column follows the
 * matrix's separate "Create or edit action items" row (Review/Discuss/Wrap up), not "Add, edit,
 * delete own card" (Write/Group) — so this can't be a simple `phaseCheck: (phase) => boolean` on
 * the registry entry; it needs the column's `kind`, which the lookup above already fetches.
 */
export const cardCreateMutation: MutationTypeDef<CardCreatePayload> = {
  schema: CardCreatePayload,
  redactable: true,
  async apply({ client, retro, user, payload }) {
    const lookup = await client.query<{ column_id: string | null; column_kind: string | null; last_position: string | null }>(
      `select
         (select id from retro_columns where id = $1 and retro_id = $2) as column_id,
         (select kind from retro_columns where id = $1 and retro_id = $2) as column_kind,
         (select position from cards where column_id = $1 order by position desc limit 1) as last_position`,
      [payload.columnId, retro.id],
    );
    const row = lookup.rows[0];
    if (!row?.column_id) {
      throw new MutationRejected(400, 'invalid_column', 'That column does not belong to this retro');
    }

    const phase = retro.phase as RetroPhase;
    const allowed = row.column_kind === 'action_items' ? allowedActions(phase).actionItemEdit : allowedActions(phase).cardCrud;
    if (!allowed) {
      throw new MutationRejected(409, 'phase_not_allowed', `card.create is not allowed during ${phase}`);
    }

    const position = generateKeyBetween(row.last_position, null);

    // node-postgres parses timestamptz columns into Date objects (unlike PostgREST, which hands
    // back ISO strings elsewhere in this app) — .toISOString() keeps this result's shape
    // consistent with BoardCard's.
    const inserted = await client.query<{ created_at: Date; updated_at: Date }>(
      `insert into cards (id, retro_id, column_id, author_id, body, position)
       values ($1, $2, $3, $4, $5, $6)
       returning created_at, updated_at`,
      [payload.cardId, retro.id, payload.columnId, user.id, payload.body, position],
    );
    const { created_at, updated_at } = inserted.rows[0]!;

    return CardCreateResult.parse({
      id: payload.cardId,
      columnId: payload.columnId,
      authorId: user.id,
      authorName: user.displayName,
      body: payload.body,
      position,
      createdAt: created_at.toISOString(),
      updatedAt: updated_at.toISOString(),
      // A brand-new card is never already part of a group (RN-015).
      topicId: null,
      hidden: false,
    });
  },
};
