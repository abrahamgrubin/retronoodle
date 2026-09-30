export * from './registry.js';
export * from './errors.js';
export * from './pipeline.js';

import { MutationRegistry } from './registry.js';
import { cardCreateMutation } from './cardCreate.js';
import { cardEditMutation } from './cardEdit.js';
import { cardDeleteMutation } from './cardDelete.js';
import { phaseNextMutation } from './phaseNext.js';
import { phaseBackMutation } from './phaseBack.js';

export function createDefaultMutationRegistry(): MutationRegistry {
  const registry = new MutationRegistry();
  registry.register('card.create', cardCreateMutation);
  registry.register('card.edit', cardEditMutation);
  registry.register('card.delete', cardDeleteMutation);
  registry.register('phase.next', phaseNextMutation);
  // phase.skip resolves to the same target as phase.next (see phaseNext.ts's own comment) — the
  // timer's Skip button (RN-012) sends this instead, so it's registered under its own type name.
  registry.register('phase.skip', phaseNextMutation);
  registry.register('phase.back', phaseBackMutation);
  return registry;
}
