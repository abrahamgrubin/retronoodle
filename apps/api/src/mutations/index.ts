export * from './registry.js';
export * from './errors.js';
export * from './pipeline.js';

import { MutationRegistry } from './registry.js';
import { cardCreateMutation } from './cardCreate.js';
import { cardEditMutation } from './cardEdit.js';
import { cardDeleteMutation } from './cardDelete.js';
import { phaseNextMutation } from './phaseNext.js';
import { phaseBackMutation } from './phaseBack.js';
import { cardsRevealMutation } from './cardsReveal.js';
import { phaseExtendMutation } from './phaseExtend.js';
import { cardMoveMutation } from './cardMove.js';
import { topicCreateFromCardsMutation } from './topicCreateFromCards.js';
import { cardAddToTopicMutation } from './cardAddToTopic.js';
import { topicRenameMutation } from './topicRename.js';
import { reactionToggleMutation } from './reactionToggle.js';
import { suggestionAcceptMutation } from './suggestionAccept.js';
import { suggestionRejectMutation } from './suggestionReject.js';
import { voteAddMutation } from './voteAdd.js';
import { voteRemoveMutation } from './voteRemove.js';
import { topicNextMutation } from './topicNext.js';
import { topicSetCurrentMutation } from './topicSetCurrent.js';
import { queueReorderMutation } from './queueReorder.js';
import { topicEditGroupSummaryMutation } from './topicEditGroupSummary.js';

export function createDefaultMutationRegistry(): MutationRegistry {
  const registry = new MutationRegistry();
  registry.register('card.create', cardCreateMutation);
  registry.register('card.edit', cardEditMutation);
  registry.register('card.delete', cardDeleteMutation);
  registry.register('card.move', cardMoveMutation);
  registry.register('topic.createFromCards', topicCreateFromCardsMutation);
  registry.register('card.addToTopic', cardAddToTopicMutation);
  registry.register('topic.rename', topicRenameMutation);
  registry.register('reaction.toggle', reactionToggleMutation);
  registry.register('suggestion.accept', suggestionAcceptMutation);
  registry.register('suggestion.reject', suggestionRejectMutation);
  registry.register('vote.add', voteAddMutation);
  registry.register('vote.remove', voteRemoveMutation);
  registry.register('topic.next', topicNextMutation);
  registry.register('topic.setCurrent', topicSetCurrentMutation);
  registry.register('queue.reorder', queueReorderMutation);
  registry.register('topic.editGroupSummary', topicEditGroupSummaryMutation);
  registry.register('phase.next', phaseNextMutation);
  // phase.skip resolves to the same target as phase.next (see phaseNext.ts's own comment) — the
  // timer's Skip button (RN-012) sends this instead, so it's registered under its own type name.
  registry.register('phase.skip', phaseNextMutation);
  registry.register('phase.back', phaseBackMutation);
  registry.register('cards.reveal', cardsRevealMutation);
  registry.register('phase.extend', phaseExtendMutation);
  return registry;
}
