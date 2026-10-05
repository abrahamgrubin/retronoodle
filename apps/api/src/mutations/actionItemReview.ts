import { ActionItemReviewPayload, ActionItemReviewResult, allowedActions, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { toActionItem, ACTION_ITEM_COLUMNS, type ActionItemRow } from './actionItemHelpers.js';

/**
 * actionItem.review (RN-025): Review phase's four quick actions. No ownership/role check beyond
 * the phase gate (`actionItemReview`), same "anyone" default as every other action-item mutation.
 * Targets any team item by `team_id`, not `source_retro_id` — the whole point is reaching items
 * carried in from a *past* retro; a fresh item created during this same Review (RN-022) is
 * rejected, since "new items created during Review ... never get a carried review row."
 *
 * Only done/in_progress/dropped change the item's own `status` (and `completed_at`, same rule as
 * RN-024's team-page status change — stamped on 'done', cleared otherwise) — `carried` ("Keep
 * open") never touches status at all, the item simply stays open/in_progress for next time.
 * Every status change is also logged to `action_item_status_changes` (RN-024's own history table)
 * so the team page's row-expand history stays complete regardless of where a change originated.
 */
export const actionItemReviewMutation: MutationTypeDef<ActionItemReviewPayload> = {
  schema: ActionItemReviewPayload,
  async apply({ client, retro, user, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).actionItemReview) {
      throw new MutationRejected(409, 'phase_not_allowed', `actionItem.review is not allowed during ${phase}`);
    }

    const existing = await client.query<{ status: string; source_retro_id: string }>(
      'select status, source_retro_id from action_items where id = $1 and team_id = $2',
      [payload.actionItemId, retro.team_id],
    );
    const row = existing.rows[0];
    if (!row) throw new MutationRejected(404, 'not_found', 'Action item not found');
    if (row.source_retro_id === retro.id) {
      throw new MutationRejected(400, 'not_reviewable', 'An item created in this retro has nothing to review');
    }

    if (payload.outcome === 'done' || payload.outcome === 'in_progress' || payload.outcome === 'dropped') {
      const completedAt = payload.outcome === 'done' ? new Date() : null;
      await client.query('update action_items set status = $1, completed_at = $2, updated_at = now() where id = $3', [
        payload.outcome,
        completedAt,
        payload.actionItemId,
      ]);
      await client.query(
        'insert into action_item_status_changes (action_item_id, from_status, to_status, actor_id) values ($1, $2, $3, $4)',
        [payload.actionItemId, row.status, payload.outcome, user.id],
      );
    }

    await client.query(
      `insert into action_item_reviews (action_item_id, retro_id, outcome, actor_id)
       values ($1, $2, $3, $4)
       on conflict (action_item_id, retro_id) do update set outcome = excluded.outcome, actor_id = excluded.actor_id, created_at = now()`,
      [payload.actionItemId, retro.id, payload.outcome, user.id],
    );

    const updated = await client.query<ActionItemRow>(`select ${ACTION_ITEM_COLUMNS} from action_items where id = $1`, [
      payload.actionItemId,
    ]);

    return ActionItemReviewResult.parse({ actionItem: toActionItem(updated.rows[0]!), outcome: payload.outcome });
  },
};
