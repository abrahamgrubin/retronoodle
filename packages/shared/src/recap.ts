import { z } from 'zod';
import { ActionItemStatus } from './actionItems.js';
import type { TopicSummaryPoint } from './topicSummaries.js';

/** One discussed topic's summary as it stood when Wrap up ended — the latest `topic_summaries`
 * version (topic-summarizer's output plus any facilitator edits from Discuss/Wrap up), flattened
 * into the same single paragraph the Wrap up screen shows (`topicSummaryParagraph`). `summary` is
 * null when the topic never got a summary. */
export const RecapTopicSummary = z.object({
  topicId: z.string().uuid(),
  topicName: z.string(),
  summary: z.string().nullable(),
});
export type RecapTopicSummary = z.infer<typeof RecapTopicSummary>;

/** Read straight from `action_items` (RN-022/024) at request time, so a status change after close
 * shows up on the recap immediately. */
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

/** The full recap (RN-045), assembled by the GET route from the same data the Wrap up screen
 * shows — no AI runs at close. No vote counts anywhere here by design. */
export const Recap = z.object({
  retroId: z.string().uuid(),
  topicSummaries: z.array(RecapTopicSummary),
  actionItems: z.array(RecapActionItem),
  undiscussedTopics: z.array(RecapUndiscussedTopic),
  attendance: z.array(z.object({ id: z.string().uuid(), displayName: z.string(), isFacilitator: z.boolean() })),
});
export type Recap = z.infer<typeof Recap>;

/** `retroName`/`isFacilitator` sit alongside the recap itself: the page's title, and whether
 * Additional notes is editable. `additionalNotes` is the facilitator's free text from Wrap up
 * (recap.editNotes), '' until written. */
export const RecapResponse = z.object({
  teamId: z.string().uuid(),
  retroName: z.string(),
  isFacilitator: z.boolean(),
  recap: Recap,
  additionalNotes: z.string(),
});
export type RecapResponse = z.infer<typeof RecapResponse>;

function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** One topic's summary as a single paragraph: key points, then decisions. Shared so the Wrap up
 * screen and the recap page always read the same. */
export function topicSummaryParagraph(summary: { keyPoints: Pick<TopicSummaryPoint, 'text'>[]; decisions: Pick<TopicSummaryPoint, 'text'>[] }): string {
  const keyPoints = summary.keyPoints.map((p) => asSentence(p.text)).join(' ');
  const decisions = summary.decisions.map((p) => asSentence(p.text)).join(' ');
  if (!keyPoints && !decisions) return 'There were no substantive key points or decisions recorded for this topic.';
  return [keyPoints, decisions && `Decisions: ${decisions}`].filter(Boolean).join(' ');
}
