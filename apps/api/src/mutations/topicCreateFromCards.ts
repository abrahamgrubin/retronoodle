import { allowedActions, TopicCreateFromCardsPayload, TopicCreateFromCardsResult, type RetroPhase } from '@retronoodle/shared';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';
import { createTopicFromCardIds } from './topicHelpers.js';

/**
 * topic.createFromCards (RN-015): "Dropping card A on card B's center creates a named group
 * containing both." Only ever grouping already-ungrouped cards (dropping onto a card that's
 * already part of a group is card.addToTopic instead — see cardAddToTopic.ts) — rejected if any
 * of `cardIds` already has one, rather than silently moving them out of their current group.
 * Groups stay within one column ("Groups stay within one column"), so every card must share one.
 * The actual validate-insert-update logic is shared with suggestion.accept (RN-017) —
 * createTopicFromCardIds, topicHelpers.ts.
 */
export const topicCreateFromCardsMutation: MutationTypeDef<TopicCreateFromCardsPayload> = {
  schema: TopicCreateFromCardsPayload,
  async apply({ client, retro, payload }) {
    const phase = retro.phase as RetroPhase;
    if (!allowedActions(phase).cardGroup) {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.createFromCards is not allowed during ${phase}`);
    }

    return TopicCreateFromCardsResult.parse(
      await createTopicFromCardIds(client, retro.id, payload.topicId, payload.cardIds, payload.name),
    );
  },
};
