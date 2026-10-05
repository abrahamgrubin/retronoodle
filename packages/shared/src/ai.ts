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

/** RN-027: "Claude spend cap $5/month in config." Per-million-token USD list pricing, used only
 * to estimate cost from each response's own reported token counts (never a billing source of
 * truth) — confirm against Anthropic's current pricing page before relying on this number in
 * production; an unknown model (a typo, or a new one added here without updating this table)
 * estimates to $0 rather than guessing, so a pricing gap silently under-counts instead of ever
 * blocking a call for the wrong reason. */
export const AI_MODEL_PRICING_USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = AI_MODEL_PRICING_USD_PER_MILLION_TOKENS[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

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
