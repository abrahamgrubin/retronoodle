import { z } from 'zod';
import { ActionItemStatus } from './actionItems.js';

/** RN-045: one topic's recap-facing summary, written by recap-summarizer once recap-filter has
 * already sanitized that topic's key points/decisions. Plain prose, no citations — unlike
 * TopicSummary, the recap isn't meant to be interactively verified against source cards or
 * transcript lines; it's a document for people who weren't in the room. */
export const RecapTopicSummary = z.object({
  topicId: z.string().uuid(),
  topicName: z.string(),
  summary: z.string(),
});
export type RecapTopicSummary = z.infer<typeof RecapTopicSummary>;

export const RecapDecision = z.object({
  topicId: z.string().uuid(),
  topicName: z.string(),
  text: z.string(),
});
export type RecapDecision = z.infer<typeof RecapDecision>;

/** Read straight from `action_items` (RN-022/024) at request time, not generated or cached here —
 * these are the team's own curated, owner-assigned entities (already free of the raw-discussion
 * noise recap-filter exists to catch), and a status change after close should show up on the
 * recap immediately rather than being frozen at whatever it was when the job ran once. */
export const RecapActionItem = z.object({
  id: z.string().uuid(),
  title: z.string(),
  ownerName: z.string().nullable(),
  status: ActionItemStatus,
});
export type RecapActionItem = z.infer<typeof RecapActionItem>;

export const RecapUndiscussedTopic = z.object({
  topicId: z.string().uuid(),
  topicName: z.string(),
});
export type RecapUndiscussedTopic = z.infer<typeof RecapUndiscussedTopic>;

/** The full recap (RN-045), assembled by the GET route from two different sources: `topicSummaries`
 * and `decisions` are the AI agent team's own stored output (`retro_recaps`, written once by
 * ai.generateRecap); `actionItems`/`undiscussedTopics`/`attendance` are computed live from their
 * own authoritative tables on every request, never cached — see recap.ts route's own comment. No
 * vote counts anywhere here by design (explicitly left out of the recap's scope). */
export const Recap = z.object({
  retroId: z.string().uuid(),
  topicSummaries: z.array(RecapTopicSummary),
  decisions: z.array(RecapDecision),
  actionItems: z.array(RecapActionItem),
  undiscussedTopics: z.array(RecapUndiscussedTopic),
  attendance: z.array(z.object({ id: z.string().uuid(), displayName: z.string() })),
  generatedAt: z.string().nullable(),
});
export type Recap = z.infer<typeof Recap>;

/** `status` mirrors the same "summarizing / ready / unavailable" shape every other AI feature in
 * this app already uses (docs/stories.md's own RN-021 panel-states note) — `recap` is null until
 * `status` is `'ready'`. `retroName`/`isFacilitator` are available regardless of `status` (the
 * page's title, and whether to show "Retry", don't need to wait on the recap itself). */
export const RecapResponse = z.object({
  teamId: z.string().uuid(),
  retroName: z.string(),
  isFacilitator: z.boolean(),
  status: z.enum(['pending', 'ready', 'unavailable']),
  recap: Recap.nullable(),
});
export type RecapResponse = z.infer<typeof RecapResponse>;
