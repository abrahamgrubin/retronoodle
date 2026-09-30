import type { HiddenBoardCard, RetroPhase, VisibleBoardCard } from '@retronoodle/shared';

export interface RedactContext {
  /** The user this card is being sent to — `undefined` for a broadcast with no single recipient
   * (the shared `retro:{retroId}` channel), where nobody is ever treated as the author. */
  viewerId: string | undefined;
  phase: RetroPhase;
  cardsRevealed: boolean;
}

/** During Write, before reveal, a card is hidden from everyone but its author. */
export function isCardCurrentlyHidden(ctx: Pick<RedactContext, 'phase' | 'cardsRevealed'>): boolean {
  return ctx.phase === 'write' && !ctx.cardsRevealed;
}

export function toHiddenCard(card: VisibleBoardCard): HiddenBoardCard {
  return { id: card.id, columnId: card.columnId, authorId: card.authorId, position: card.position, hidden: true };
}

/**
 * The one outbound hiding function (CLAUDE.md: "Every outbound broadcast and board read passes
 * through the single hiding function"), used by `GET /retros/:id/board` (once per card, for the
 * requesting viewer) and by the mutation pipeline (apps/api/src/mutations/pipeline.ts, deciding
 * what a `card.create`/`card.edit` broadcast to the shared `retro:{retroId}` channel may contain
 * — there, `viewerId` is left `undefined` since that channel has no single recipient to be the
 * author for; the full card still goes out separately to the author's own `user:{id}` channel).
 */
export function redactCard(card: VisibleBoardCard, ctx: RedactContext): VisibleBoardCard | HiddenBoardCard {
  const isAuthor = ctx.viewerId !== undefined && card.authorId === ctx.viewerId;
  if (isAuthor || !isCardCurrentlyHidden(ctx)) return card;
  return toHiddenCard(card);
}
