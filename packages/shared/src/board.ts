import { z } from 'zod';
import { RetroPhase, TemplateSource } from './retros.js';

export const BoardColumn = z.object({
  id: z.string().uuid(),
  title: z.string(),
  prompt: z.string().nullable(),
  color: z.string(),
  kind: z.enum(['standard', 'action_items']),
  position: z.number().int(),
});
export type BoardColumn = z.infer<typeof BoardColumn>;

export const VisibleBoardCard = z.object({
  id: z.string().uuid(),
  columnId: z.string().uuid(),
  authorId: z.string().uuid(),
  authorName: z.string(),
  body: z.string(),
  position: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  hidden: z.literal(false),
});
export type VisibleBoardCard = z.infer<typeof VisibleBoardCard>;

/** What a non-author sees for a card hidden during Write (RN-011): never `body`, `authorName`,
 * `createdAt` or `updatedAt` — CLAUDE.md: "Hidden card text and votes never leave the server." */
export const HiddenBoardCard = z.object({
  id: z.string().uuid(),
  columnId: z.string().uuid(),
  authorId: z.string().uuid(),
  position: z.string(),
  hidden: z.literal(true),
});
export type HiddenBoardCard = z.infer<typeof HiddenBoardCard>;

export const BoardCard = z.discriminatedUnion('hidden', [VisibleBoardCard, HiddenBoardCard]);
export type BoardCard = z.infer<typeof BoardCard>;

/** GET /retros/:id/board (RN-009): the initial snapshot, plus the seq it's current as of —
 * events broadcast after this point are applied on top (RN-008's retroStore), not re-fetched. */
export const BoardResponse = z.object({
  retro: z.object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    name: z.string(),
    phase: RetroPhase,
    facilitatorId: z.string().uuid(),
    templateId: z.string().uuid(),
    templateSource: TemplateSource,
    // RN-011: whether the facilitator has revealed Write-phase cards. Only matters while still
    // in Write — every later phase shows full cards regardless.
    cardsRevealed: z.boolean(),
  }),
  columns: z.array(BoardColumn),
  cards: z.array(BoardCard),
  seq: z.number().int().nonnegative(),
});
export type BoardResponse = z.infer<typeof BoardResponse>;
