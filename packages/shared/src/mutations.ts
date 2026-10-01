import { z } from 'zod';
import { RetroPhase } from './retros.js';
import { VisibleBoardCard } from './board.js';

/** POST /retros/:id/mutations body (RN-008). Every mutation type has its own payload schema
 * below; the envelope itself only knows the type name and a client-generated mutationId used
 * for idempotency (replaying the same mutationId returns the original result, unapplied again). */
export const MutationEnvelope = z.object({
  mutationId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.unknown(),
});
export type MutationEnvelope = z.infer<typeof MutationEnvelope>;

export const MutationResponse = z.object({
  seq: z.number().int().positive(),
  result: z.unknown(),
});
export type MutationResponse = z.infer<typeof MutationResponse>;

/** RN-009: "empty body is rejected client and server side" / a 501-character body is rejected. */
export const CardBody = z.string().min(1).max(500);

export const CardCreatePayload = z.object({
  cardId: z.string().uuid(),
  columnId: z.string().uuid(),
  body: CardBody,
});
export type CardCreatePayload = z.infer<typeof CardCreatePayload>;

// Both create and edit return the full card, VisibleBoardCard-shaped (RN-011: redact() needs a
// stable, complete input — id/columnId/authorId/position at minimum — to build the hidden
// broadcast shape, so there's no separate, leaner "just what changed" result type here).
export const CardCreateResult = VisibleBoardCard;
export type CardCreateResult = VisibleBoardCard;

export const CardEditPayload = z.object({
  cardId: z.string().uuid(),
  body: CardBody,
});
export type CardEditPayload = z.infer<typeof CardEditPayload>;

export const CardEditResult = VisibleBoardCard;
export type CardEditResult = VisibleBoardCard;

export const CardDeletePayload = z.object({
  cardId: z.string().uuid(),
});
export type CardDeletePayload = z.infer<typeof CardDeletePayload>;

export const CardDeleteResult = z.object({
  id: z.string().uuid(),
});
export type CardDeleteResult = z.infer<typeof CardDeleteResult>;

/** `card.move` (RN-014): one mutation per drop — reordering within a column and moving across
 * columns are the same shape, distinguished only by whether `columnId` changed. `position` is a
 * fractional-indexing text key computed client-side (dnd-kit knows the drop target's neighbor
 * cards; the server just stores what it's given, the same way card.create's position — appended
 * after the last card — is server-computed because *that* story has no drop target to derive it
 * from). Redactable like create/edit (RN-011): a hidden card's own author moving it during Write
 * must not leak its body to everyone else on the shared channel. */
export const CardMovePayload = z.object({
  cardId: z.string().uuid(),
  columnId: z.string().uuid(),
  position: z.string().min(1),
});
export type CardMovePayload = z.infer<typeof CardMovePayload>;

export const CardMoveResult = VisibleBoardCard;
export type CardMoveResult = VisibleBoardCard;

/** `phase.next`, `phase.back`, `phase.skip` (RN-010): the target phase is always derived from
 * the retro's current phase server-side (via stateMachine's nextPhase/previousPhase), never
 * supplied by the caller, so there's nothing to carry in the payload. */
export const PhaseTransitionPayload = z.object({}).strict();
export type PhaseTransitionPayload = z.infer<typeof PhaseTransitionPayload>;

export const PhaseTransitionResult = z.object({
  phase: RetroPhase,
  // RN-012: every transition sets a fresh deadline for the phase it lands on (its own default
  // duration) — null only for setup/closed, neither of which nextPhase/previousPhase ever
  // actually returns as a target, but the type stays honest about stateMachine's own shape.
  phaseDeadline: z.string().nullable(),
});
export type PhaseTransitionResult = z.infer<typeof PhaseTransitionResult>;

/** `cards.reveal` (RN-011): facilitator-only, Write phase only. Broadcasts every card in full —
 * this is the one mutation type that's deliberately never passed through redact(). */
export const CardsRevealPayload = z.object({}).strict();
export type CardsRevealPayload = z.infer<typeof CardsRevealPayload>;

export const CardsRevealResult = z.object({
  cards: z.array(VisibleBoardCard),
});
export type CardsRevealResult = z.infer<typeof CardsRevealResult>;

/** `phase.extend` (RN-012): facilitator-only. Adds `minutes` to the current phase's countdown —
 * from now, not from the stale deadline, if the timer had already hit zero. */
export const PhaseExtendPayload = z.object({
  minutes: z.union([z.literal(1), z.literal(2), z.literal(5)]),
});
export type PhaseExtendPayload = z.infer<typeof PhaseExtendPayload>;

export const PhaseExtendResult = z.object({
  phaseDeadline: z.string(),
});
export type PhaseExtendResult = z.infer<typeof PhaseExtendResult>;
