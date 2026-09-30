export * from './registry.js';
export * from './errors.js';
export * from './pipeline.js';

import { MutationRegistry } from './registry.js';
import { cardCreateMutation } from './cardCreate.js';
import { cardEditMutation } from './cardEdit.js';
import { cardDeleteMutation } from './cardDelete.js';

export function createDefaultMutationRegistry(): MutationRegistry {
  const registry = new MutationRegistry();
  registry.register('card.create', cardCreateMutation);
  registry.register('card.edit', cardEditMutation);
  registry.register('card.delete', cardDeleteMutation);
  return registry;
}
