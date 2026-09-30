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

/** `phase.next`, `phase.back`, `phase.skip` (RN-010): the target phase is always derived from
 * the retro's current phase server-side (via stateMachine's nextPhase/previousPhase), never
 * supplied by the caller, so there's nothing to carry in the payload. */
export const PhaseTransitionPayload = z.object({}).strict();
export type PhaseTransitionPayload = z.infer<typeof PhaseTransitionPayload>;

export const PhaseTransitionResult = z.object({
  phase: RetroPhase,
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
