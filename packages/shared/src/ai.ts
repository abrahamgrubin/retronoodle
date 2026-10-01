import { z } from 'zod';

/** Model names and limits live here, never hard-coded at AI call sites (CLAUDE.md). */
export const AI_GROUPING_MODEL = 'claude-haiku-4-5-20251001';

/** One AI-suggested group (RN-017) — "facilitator only" (CLAUDE.md), never sent to anyone else.
 * `columnId` isn't stored on the `group_suggestions` row itself (every member card already has
 * one, and a suggestion's own validation already guarantees they all agree), so this is derived
 * wherever a suggestion is read, not a separate source of truth. */
export const GroupSuggestion = z.object({
  id: z.string().uuid(),
  name: z.string(),
  columnId: z.string().uuid(),
  cardIds: z.array(z.string().uuid()).min(2),
});
export type GroupSuggestion = z.infer<typeof GroupSuggestion>;
