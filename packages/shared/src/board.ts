import { z } from 'zod';
import { RetroPhase, TemplateSource } from './retros.js';
import { Topic } from './topics.js';
import { ReactionSummary } from './reactions.js';

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
  // RN-015: null until the card joins a group. Grouping only ever happens once cards are already
  // revealed (Group phase onward), so this is never a redaction concern the way body/authorName
  // are — a hidden card's topicId (always null in practice, since topics don't exist yet in
  // Write) is still included below for schema symmetry, not because it ever carries anything.
  topicId: z.string().uuid().nullable(),
  // RN-016: "Never on hidden cards" — a card is never reactable before it's ever been visible,
  // so HiddenBoardCard (below) has no equivalent field at all, not even an always-empty one.
  reactions: z.array(ReactionSummary),
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
  topicId: z.string().uuid().nullable(),
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
    // RN-012: when the current phase's countdown ends; null for a phase with no timer (setup,
    // closed). Broadcast fresh on every phase transition and on phase.extend.
    phaseDeadline: z.string().nullable(),
  }),
  columns: z.array(BoardColumn),
  cards: z.array(BoardCard),
  // RN-015: every topic in the retro, regardless of column — the client matches cards to topics
  // by `BoardCard.topicId`, not the other way around (see topics.ts).
  topics: z.array(Topic),
  seq: z.number().int().nonnegative(),
  // RN-012: "every API response includes serverTime" — the client compares this to its own
  // clock once, at load, to get a stable offset, then counts the phase timer down locally
  // against that offset rather than trusting its own clock or polling the server every second.
  serverTime: z.string(),
});
export type BoardResponse = z.infer<typeof BoardResponse>;
