import type { BoardCard, BoardColumn, CardCreateResult, CardDeleteResult, CardEditResult } from '@retronoodle/shared';
import type { RetroEvent } from './retroStore';

export interface BoardState {
  columns: BoardColumn[];
  cards: BoardCard[];
}

/** Folds one confirmed card.* event into board state (RN-009). Used both for events replayed
 * from the initial snapshot's point forward and for a card the caller just created/edited/
 * deleted themselves optimistically — card.create upserts by id rather than always appending,
 * since the optimistic card may already be there under the same client-generated id. */
export function reduceBoard(board: BoardState, event: RetroEvent): BoardState {
  switch (event.type) {
    case 'card.create': {
      const result = event.payload as CardCreateResult;
      const card: BoardCard = {
        id: result.id,
        columnId: result.columnId,
        authorId: result.authorId,
        authorName: result.authorName,
        body: result.body,
        position: result.position,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
      const exists = board.cards.some((c) => c.id === card.id);
      return { ...board, cards: exists ? board.cards.map((c) => (c.id === card.id ? card : c)) : [...board.cards, card] };
    }
    case 'card.edit': {
      const result = event.payload as CardEditResult;
      return { ...board, cards: board.cards.map((c) => (c.id === result.id ? { ...c, body: result.body } : c)) };
    }
    case 'card.delete': {
      const result = event.payload as CardDeleteResult;
      return { ...board, cards: board.cards.filter((c) => c.id !== result.id) };
    }
    default:
      return board;
  }
}
