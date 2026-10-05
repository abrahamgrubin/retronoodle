import { z } from 'zod';

export const ActionItemStatus = z.enum(['open', 'in_progress', 'done', 'dropped']);
export type ActionItemStatus = z.infer<typeof ActionItemStatus>;

export const ActionItemOrigin = z.enum(['ai', 'manual']);
export type ActionItemOrigin = z.infer<typeof ActionItemOrigin>;

/** RN-025's four Review-phase quick actions. `carried` is never a button of its own ("Keep open"
 * writes it directly) — it's also what the review->write sweep stamps on anything left
 * unmarked, so an explicit "Keep open" click and silently doing nothing produce the identical
 * outcome value. Only `done`/`in_progress`/`dropped` ever change the item's own `status`. */
export const ActionItemReviewOutcome = z.enum(['done', 'in_progress', 'dropped', 'carried']);
export type ActionItemReviewOutcome = z.infer<typeof ActionItemReviewOutcome>;

/** RN-022. `sourceTopicId` is null for an item created directly in the Action items column (no
 * proposal behind it) — never null for one created via "Add as action item" on a proposed item.
 * `dueDate` is a plain date (`YYYY-MM-DD`), not a timestamp — there's no time-of-day concept for
 * a due date. Status editing (marking one done, carrying it to the next retro) is RN-024/RN-025;
 * this story only ever writes `status: 'open'` at creation and never changes it afterward. */
export const ActionItem = z.object({
  id: z.string().uuid(),
  sourceRetroId: z.string().uuid(),
  sourceTopicId: z.string().uuid().nullable(),
  title: z.string(),
  ownerId: z.string().uuid().nullable(),
  dueDate: z.string().nullable(),
  status: ActionItemStatus,
  origin: ActionItemOrigin,
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ActionItem = z.infer<typeof ActionItem>;
