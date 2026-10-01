import type {
  BoardCard,
  BoardColumn,
  CardAddToTopicResult,
  CardDeleteResult,
  CardMoveResult,
  CardsRevealResult,
  HiddenBoardCard,
  PhaseExtendResult,
  PhaseTransitionResult,
  ReactionSummary,
  ReactionToggleResult,
  RetroPhase,
  Topic,
  TopicCreateFromCardsResult,
  TopicRenameResult,
  VisibleBoardCard,
} from '@retronoodle/shared';
import type { RetroEvent } from './retroStore';

export interface BoardState {
  phase: RetroPhase;
  cardsRevealed: boolean;
  // RN-012: null for a phase with no timer (setup, closed). An ISO timestamp otherwise, counted
  // down client-side against the clock offset — see clock.ts.
  phaseDeadline: string | null;
  columns: BoardColumn[];
  cards: BoardCard[];
  // RN-015: topics the retro has so far. A card's membership lives on the card (`topicId`), not
  // here — see topics.ts's own comment on why a topic doesn't carry its own card list.
  topics: Topic[];
}

function isHiddenPayload(payload: unknown): payload is HiddenBoardCard {
  return typeof payload === 'object' && payload !== null && (payload as { hidden?: unknown }).hidden === true;
}

function upsertCard(board: BoardState, card: BoardCard): BoardState {
  const existing = board.cards.find((c) => c.id === card.id);
  // Never let a redacted echo of a card we already hold in full get clobbered back to hidden —
  // the shared retro:{retroId} channel always sends the redacted shape during Write, even for
  // the author's own card (RN-011); the author's local copy (optimistic, or already patched in
  // via the private user:{id} channel) is always more authoritative for the same id.
  if (card.hidden && existing && !existing.hidden) return board;
  // RN-016: card.create/edit/move/grouping results never carry real reaction data — a separate
  // table none of those mutations touch (see e.g. cardEdit.ts's own comment) — so trusting
  // whatever they report here would wipe out real reactions on every edit/move/group. Preserve
  // this client's existing reactions for the card instead; a brand-new card (no `existing`)
  // legitimately has none yet.
  const next: BoardCard = !card.hidden && existing && !existing.hidden ? { ...card, reactions: existing.reactions } : card;
  return { ...board, cards: existing ? board.cards.map((c) => (c.id === card.id ? next : c)) : [...board.cards, next] };
}

/** Applies one reaction.toggle result (RN-016) to a card's reaction list — exported so
 * BoardPage.tsx's optimistic toggle can reuse the exact same add/remove logic instead of
 * re-deriving it, just with a locally-guessed `added` rather than the server's confirmed one. */
export function toggleReaction(reactions: ReactionSummary[], { emoji, userId, added }: ReactionToggleResult): ReactionSummary[] {
  const idx = reactions.findIndex((r) => r.emoji === emoji);
  if (added) {
    if (idx === -1) return [...reactions, { emoji, userIds: [userId] }];
    if (reactions[idx]!.userIds.includes(userId)) return reactions; // already applied (idempotent replay)
    return reactions.map((r, i) => (i === idx ? { ...r, userIds: [...r.userIds, userId] } : r));
  }
  if (idx === -1) return reactions;
  const userIds = reactions[idx]!.userIds.filter((id) => id !== userId);
  return userIds.length > 0 ? reactions.map((r, i) => (i === idx ? { ...r, userIds } : r)) : reactions.filter((_, i) => i !== idx);
}

/** card.create and card.edit (RN-009, RN-011) broadcast the same VisibleBoardCard- or
 * HiddenBoardCard-shaped result and fold into board state identically — upsert by id, with
 * upsertCard's clobber guard protecting a card already held in full. card.move (RN-014) used to
 * share this path too, but its result is no longer a bare card (RN-015's dissolvedTopic) — see
 * its own case below. */
function upsertFromCardEvent(board: BoardState, payload: unknown): BoardState {
  const result = payload as VisibleBoardCard | HiddenBoardCard;
  const card: BoardCard = isHiddenPayload(result)
    ? { id: result.id, columnId: result.columnId, authorId: result.authorId, position: result.position, topicId: result.topicId, hidden: true }
    : { ...result, hidden: false };
  return upsertCard(board, card);
}

function upsertTopic(board: BoardState, topic: Topic): BoardState {
  const existing = board.topics.find((t) => t.id === topic.id);
  return { ...board, topics: existing ? board.topics.map((t) => (t.id === topic.id ? topic : t)) : [...board.topics, topic] };
}

/** Folds a `dissolvedTopic` (RN-015: "a one-card group dissolves"), shared by card.move and
 * card.addToTopic's results — the one other card whose membership silently changed, plus the
 * topic it (and the card the caller actually acted on) no longer belong to. */
function applyDissolvedTopic(board: BoardState, dissolvedTopic: { topicId: string; remainingCard: VisibleBoardCard } | null): BoardState {
  if (!dissolvedTopic) return board;
  return upsertCard(
    { ...board, topics: board.topics.filter((t) => t.id !== dissolvedTopic.topicId) },
    { ...dissolvedTopic.remainingCard, hidden: false },
  );
}

/** Folds one confirmed event (card create/edit/delete, a phase transition, or a reveal) into
 * board state (RN-009, extended by RN-010's phase tracking and RN-011's hidden cards). Used both
 * for events replayed from the initial snapshot's point forward and for a card the caller just
 * created/edited/deleted themselves optimistically — card.create/card.edit upsert by id rather
 * than always appending, since the optimistic card may already be there under the same
 * client-generated id. */
export function reduceBoard(board: BoardState, event: RetroEvent): BoardState {
  switch (event.type) {
    case 'card.create':
    case 'card.edit': {
      return upsertFromCardEvent(board, event.payload);
    }
    // card.move (RN-014, extended by RN-015): the card half of this is the same redactable-card
    // shape create/edit get, but it's wrapped (`{card, dissolvedTopic}`) rather than bare, since a
    // move can also silently ungroup a *different* card ("a one-card group dissolves") — so this
    // can't reuse upsertFromCardEvent directly.
    case 'card.move': {
      const result = event.payload as CardMoveResult;
      return applyDissolvedTopic(upsertFromCardEvent(board, result.card), result.dissolvedTopic);
    }
    case 'card.delete': {
      const result = event.payload as CardDeleteResult;
      return { ...board, cards: board.cards.filter((c) => c.id !== result.id) };
    }
    // topic.createFromCards (RN-015): "Dropping card A on card B's center creates a named group
    // containing both" — a new topic plus every card now in it (never redacted: grouping only
    // ever happens once cards are already revealed).
    case 'topic.createFromCards': {
      const result = event.payload as TopicCreateFromCardsResult;
      const withTopic = upsertTopic(board, result.topic);
      return result.cards.reduce((b, card) => upsertCard(b, { ...card, hidden: false }), withTopic);
    }
    // card.addToTopic (RN-015): joining an existing group — can itself dissolve the card's
    // *previous* group (dissolvedTopic), same as card.move.
    case 'card.addToTopic': {
      const result = event.payload as CardAddToTopicResult;
      const withTopic = upsertTopic(board, result.topic);
      const withCard = upsertCard(withTopic, { ...result.card, hidden: false });
      return applyDissolvedTopic(withCard, result.dissolvedTopic);
    }
    // topic.rename (RN-015): "Anyone can rename a group; the last rename wins and syncs to all."
    case 'topic.rename': {
      const result = event.payload as TopicRenameResult;
      return upsertTopic(board, result.topic);
    }
    // reaction.toggle (RN-016): never redacted — reacting is impossible on a hidden card in the
    // first place, so there's no non-author/hidden variant to fold here, unlike card.create/edit.
    case 'reaction.toggle': {
      const result = event.payload as ReactionToggleResult;
      return {
        ...board,
        cards: board.cards.map((c) => (c.id === result.cardId && !c.hidden ? { ...c, reactions: toggleReaction(c.reactions, result) } : c)),
      };
    }
    // phase.next and phase.skip resolve to the same target phase server-side (RN-010) — both
    // broadcast the same result shape, so both fold into board state the same way here too.
    case 'phase.next':
    case 'phase.skip':
    case 'phase.back': {
      const result = event.payload as PhaseTransitionResult;
      return { ...board, phase: result.phase, phaseDeadline: result.phaseDeadline };
    }
    // phase.extend (RN-012): only the deadline changes, not the phase itself.
    case 'phase.extend': {
      const result = event.payload as PhaseExtendResult;
      return { ...board, phaseDeadline: result.phaseDeadline };
    }
    // cards.reveal (RN-011): the facilitator's manual Reveal — every card comes back in full.
    case 'cards.reveal': {
      const result = event.payload as CardsRevealResult;
      const byId = new Map(result.cards.map((c) => [c.id, c]));
      return {
        ...board,
        cardsRevealed: true,
        cards: board.cards.map((c) => (byId.has(c.id) ? { ...byId.get(c.id)!, hidden: false } : c)),
      };
    }
    default:
      return board;
  }
}
