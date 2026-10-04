import { z } from 'zod';

/** One bullet in a topic summary (RN-021). AI-generated points always have at least one source —
 * "every rendered point has at least one valid source" (the story's own AC) — but that's the
 * worker job's own filtering rule (it drops anything citing zero or unknown ids), not a schema
 * constraint here: the facilitator's own manual edits (topic.editSummary) aren't tied to specific
 * cards at all ("one text area per section" — free text, not per-point source picking), so an
 * edited point legitimately has `sources: []`. The UI simply omits the source chip when empty. */
export const TopicSummaryPoint = z.object({
  text: z.string().min(1),
  sources: z.array(z.string().uuid()),
});
export type TopicSummaryPoint = z.infer<typeof TopicSummaryPoint>;

/** The latest generation of one topic's AI summary — "latest" because that's all the board ever
 * shows (the footer's version label is informational, not a version browser). `edited` flips to
 * true the moment the facilitator saves a manual edit over it; `editRatio` stays null until
 * RN-023 computes it at close (Levenshtein share) — this story only ever writes `edited`. */
export const TopicSummary = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  version: z.number().int().positive(),
  model: z.string(),
  promptVersion: z.string(),
  keyPoints: z.array(TopicSummaryPoint),
  decisions: z.array(TopicSummaryPoint),
  disagreements: z.array(TopicSummaryPoint),
  proposedActionItems: z.array(TopicSummaryPoint),
  edited: z.boolean(),
  editRatio: z.number().nullable(),
  createdAt: z.string(),
});
export type TopicSummary = z.infer<typeof TopicSummary>;
