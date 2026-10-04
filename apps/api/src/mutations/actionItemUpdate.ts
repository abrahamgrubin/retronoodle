import { ActionItemUpdatePayload, ActionItemUpdateResult, allowedActions, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { toActionItem, ACTION_ITEM_COLUMNS, type ActionItemRow } from './actionItemHelpers.js';

/**
 * actionItem.update (RN-022): "owner and due date are editable inline" (title too, since the
 * manual-creation form and the inline row share the same fields). Same `actionItemEdit` gate and
 * no ownership check as actionItem.create. Partial: only the fields the client actually sent are
 * overwritten, via `coalesce` against the existing row rather than a blanket `set` — a client only
 * ever sends the one field it's editing, not the whole item.
 */
export const actionItemUpdateMutation: MutationTypeDef<ActionItemUpdatePayload> = {
  schema: ActionItemUpdatePayload,
  async apply({ client, retro, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).actionItemEdit) {
      throw new MutationRejected(409, 'phase_not_allowed', `actionItem.update is not allowed during ${phase}`);
    }

    const existing = await client.query('select id from action_items where id = $1 and source_retro_id = $2', [
      payload.id,
      retro.id,
    ]);
    if (existing.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Action item not found');

    const updated = await client.query<ActionItemRow>(
      `update action_items
       set title = coalesce($1, title),
           owner_id = case when $2 then $3 else owner_id end,
           due_date = case when $4 then $5 else due_date end,
           updated_at = now()
       where id = $6
       returning ${ACTION_ITEM_COLUMNS}`,
      [
        payload.title ?? null,
        payload.ownerId !== undefined,
        payload.ownerId ?? null,
        payload.dueDate !== undefined,
        payload.dueDate ?? null,
        payload.id,
      ],
    );

    return ActionItemUpdateResult.parse({ actionItem: toActionItem(updated.rows[0]!) });
  },
};
