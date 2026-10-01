import type {
  BoardCard,
  BoardColumn,
  CardDeleteResult,
  CardsRevealResult,
  HiddenBoardCard,
  PhaseExtendResult,
  PhaseTransitionResult,
  RetroPhase,
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
  return { ...board, cards: existing ? board.cards.map((c) => (c.id === card.id ? card : c)) : [...board.cards, card] };
}

/** card.create, card.edit and card.move (RN-009/RN-014) all broadcast the same VisibleBoardCard-
 * or-HiddenBoardCard-shaped result and fold into board state identically — upsert by id, with
 * upsertCard's clobber guard protecting a card already held in full. */
function upsertFromCardEvent(board: BoardState, payload: unknown): BoardState {
  const result = payload as VisibleBoardCard | HiddenBoardCard;
  const card: BoardCard = isHiddenPayload(result)
    ? { id: result.id, columnId: result.columnId, authorId: result.authorId, position: result.position, hidden: true }
    : { ...result, hidden: false };
  return upsertCard(board, card);
}

/** Folds one confirmed event (card create/edit/delete, a phase transition, or a reveal) into
 * board state (RN-009, extended by RN-010's phase tracking and RN-011's hidden cards). Used both
 * for events replayed from the initial snapshot's point forward and for a card the caller just
 * created/edited/deleted themselves optimistically — card.create/card.edit upsert by id rather
 * than always appending, since the optimistic card may already be there under the same
 * client-generated id. */
export function reduceBoard(board: BoardState, event: RetroEvent): BoardState {
  switch (event.type) {
    // card.move (RN-014): a hidden echo carries nothing a non-author didn't already know (the
    // placeholder never showed a body, and its position/columnId are already in the redacted
    // shape) — upsertFromCardEvent's clobber guard handles it the same way create/edit's does.
    case 'card.create':
    case 'card.edit':
    case 'card.move': {
      return upsertFromCardEvent(board, event.payload);
    }
    case 'card.delete': {
      const result = event.payload as CardDeleteResult;
      return { ...board, cards: board.cards.filter((c) => c.id !== result.id) };
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
