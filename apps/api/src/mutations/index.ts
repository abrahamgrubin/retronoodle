export * from './registry.js';
export * from './errors.js';
export * from './pipeline.js';

import { MutationRegistry } from './registry.js';
import { cardCreateMutation } from './cardCreate.js';

export function createDefaultMutationRegistry(): MutationRegistry {
  const registry = new MutationRegistry();
  registry.register('card.create', cardCreateMutation);
  return registry;
}
