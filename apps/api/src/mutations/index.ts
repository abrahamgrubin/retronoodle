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

export function createDefaultMutationRegistry(): MutationRegistry {
  const registry = new MutationRegistry();
  registry.register('card.create', cardCreateMutation);
  registry.register('card.edit', cardEditMutation);
  registry.register('card.delete', cardDeleteMutation);
  registry.register('card.move', cardMoveMutation);
  registry.register('topic.createFromCards', topicCreateFromCardsMutation);
  registry.register('card.addToTopic', cardAddToTopicMutation);
  registry.register('topic.rename', topicRenameMutation);
  registry.register('phase.next', phaseNextMutation);
  // phase.skip resolves to the same target as phase.next (see phaseNext.ts's own comment) — the
  // timer's Skip button (RN-012) sends this instead, so it's registered under its own type name.
  registry.register('phase.skip', phaseNextMutation);
  registry.register('phase.back', phaseBackMutation);
  registry.register('cards.reveal', cardsRevealMutation);
  registry.register('phase.extend', phaseExtendMutation);
  return registry;
}
