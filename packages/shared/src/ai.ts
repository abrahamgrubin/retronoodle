import { z } from 'zod';

/** Model names and limits live here, never hard-coded at AI call sites (CLAUDE.md). */
export const AI_GROUPING_MODEL = 'claude-haiku-4-5-20251001';
// Homework: AI agent team.
export const AI_GROUP_SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
export const AI_QUESTION_SUGGESTER_MODEL = 'claude-haiku-4-5-20251001';
// RN-021: primary + fallback for the one topic-summarizer prompt — "25s timeout → one retry on
// Haiku" (docs/stories.md). Same prompt both attempts; only the model differs.
export const AI_TOPIC_SUMMARY_MODEL = 'claude-sonnet-5';
export const AI_TOPIC_SUMMARY_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
export const AI_TOPIC_SUMMARY_TIMEOUT_MS = 25_000;

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
