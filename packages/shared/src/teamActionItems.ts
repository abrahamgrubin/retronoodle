import { z } from 'zod';
import { ActionItemOrigin, ActionItemStatus } from './actionItems.js';

/** One row in the team action-item list (RN-024, `GET /teams/:id/actions`) — a flattened,
 * display-ready shape (owner and source-retro names already joined server-side), not the raw
 * `ActionItem` the retro board itself works with. */
export const TeamActionItem = z.object({
  id: z.string().uuid(),
  title: z.string(),
  ownerId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: ActionItemStatus,
  origin: ActionItemOrigin,
  completedAt: z.string().nullable(),
  sourceRetroId: z.string().uuid(),
  sourceRetroName: z.string(),
  updatedAt: z.string(),
});
export type TeamActionItem = z.infer<typeof TeamActionItem>;

export const TeamActionItemsResponse = z.object({
  items: z.array(TeamActionItem),
});
export type TeamActionItemsResponse = z.infer<typeof TeamActionItemsResponse>;

/** `POST /teams/:id/actions/:itemId/status` (RN-024): "Any team member may change status" — no
 * ownership check, same as actionItem.create/update's own "anyone" precedent, just outside the
 * retro mutation pipeline entirely (this page works between retros, with no retro phase to gate
 * against). Setting `done` stamps `completedAt` server-side; any other status clears it. */
export const ActionItemStatusChangePayload = z.object({
  status: ActionItemStatus,
});
export type ActionItemStatusChangePayload = z.infer<typeof ActionItemStatusChangePayload>;

export const ActionItemStatusChangeResult = z.object({
  item: TeamActionItem,
});
export type ActionItemStatusChangeResult = z.infer<typeof ActionItemStatusChangeResult>;

/** One entry in an item's status history ("row expand ... who changed what, when"). Newest first
 * — the row-expand UI is a log, not a timeline someone reads top-to-bottom. */
export const ActionItemStatusHistoryEntry = z.object({
  id: z.string().uuid(),
  fromStatus: ActionItemStatus,
  toStatus: ActionItemStatus,
  actorId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});
export type ActionItemStatusHistoryEntry = z.infer<typeof ActionItemStatusHistoryEntry>;

export const ActionItemStatusHistoryResponse = z.object({
  entries: z.array(ActionItemStatusHistoryEntry),
});
export type ActionItemStatusHistoryResponse = z.infer<typeof ActionItemStatusHistoryResponse>;
