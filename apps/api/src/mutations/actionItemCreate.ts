import { ActionItemCreatePayload, ActionItemCreateResult, allowedActions, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { toActionItem, ACTION_ITEM_COLUMNS, type ActionItemRow } from './actionItemHelpers.js';

/**
 * actionItem.create (RN-022): "turn AI proposals or my own words into action items" — no
 * ownership check (the story never says "facilitator-only"), just the same `actionItemEdit` gate
 * (Review, Discuss, Wrap up) as actionItem.update. An item created in Review has no source topic
 * (`source_topic_id` null) and counts as this retro's own item (`source_retro_id = retro.id`) —
 * same as any other phase, since Review's "carried items" (RN-025) are a read-side concern, not a
 * write-side one.
 */
export const actionItemCreateMutation: MutationTypeDef<ActionItemCreatePayload> = {
  schema: ActionItemCreatePayload,
  async apply({ client, retro, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).actionItemEdit) {
      throw new MutationRejected(409, 'phase_not_allowed', `actionItem.create is not allowed during ${phase}`);
    }

    if (payload.sourceTopicId) {
      const topic = await client.query('select id from topics where id = $1 and retro_id = $2', [
        payload.sourceTopicId,
        retro.id,
      ]);
      if (topic.rows.length === 0) throw new MutationRejected(404, 'not_found', 'Topic not found');
    }

    const inserted = await client.query<ActionItemRow>(
      `insert into action_items (id, team_id, source_retro_id, source_topic_id, title, owner_id, due_date, status, origin)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', $8)
       returning ${ACTION_ITEM_COLUMNS}`,
      [
        payload.id,
        retro.team_id,
        retro.id,
        payload.sourceTopicId,
        payload.title,
        payload.ownerId,
        payload.dueDate,
        payload.origin,
      ],
    );

    return ActionItemCreateResult.parse({ actionItem: toActionItem(inserted.rows[0]!) });
  },
};
