import { z } from 'zod';

export const ActionItemStatus = z.enum(['open', 'in_progress', 'done', 'dropped']);
export type ActionItemStatus = z.infer<typeof ActionItemStatus>;

export const ActionItemOrigin = z.enum(['ai', 'manual']);
export type ActionItemOrigin = z.infer<typeof ActionItemOrigin>;

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
