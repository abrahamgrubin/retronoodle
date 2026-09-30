import { describe, expect, it } from 'vitest';
import { reduceBoard, type BoardState } from './boardReducer';
import type { RetroEvent } from './retroStore';

const columnId = '00000000-0000-4000-8000-000000000001';
const cardId = '00000000-0000-4000-8000-000000000002';
const authorId = '00000000-0000-4000-8000-000000000003';

const emptyBoard: BoardState = { phase: 'write', cardsRevealed: false, columns: [], cards: [] };

function createEvent(overrides: Partial<Record<string, unknown>> = {}): RetroEvent {
  return {
    seq: 1,
    type: 'card.create',
    payload: {
      id: cardId,
      columnId,
      authorId,
      authorName: 'Ada',
      body: 'Ship it',
      position: 'a0',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      hidden: false,
      ...overrides,
    },
  };
}

function hiddenPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: cardId, columnId, authorId, position: 'a0', hidden: true, ...overrides };
}

describe('reduceBoard', () => {
  it('card.create appends a new card', () => {
    const board = reduceBoard(emptyBoard, createEvent());
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]).toMatchObject({ id: cardId, body: 'Ship it', authorName: 'Ada', hidden: false });
  });

  it('card.create upserts (does not duplicate) when the card id already exists — the optimistic-then-confirmed case', () => {
    const afterOptimistic = reduceBoard(emptyBoard, createEvent({ body: 'Optimistic body' }));
    const afterConfirmed = reduceBoard(afterOptimistic, createEvent({ body: 'Confirmed body' }));
    expect(afterConfirmed.cards).toHaveLength(1);
    expect(afterConfirmed.cards[0]).toMatchObject({ body: 'Confirmed body' });
  });

  it('card.edit updates the matching card with the full confirmed card', () => {
    const board = reduceBoard(emptyBoard, createEvent());
    const edited = reduceBoard(board, createEvent({ body: 'Edited body' }));
    expect(edited.cards[0]).toMatchObject({ body: 'Edited body', authorName: 'Ada' }); // authorName untouched
  });

  it('card.delete removes the matching card', () => {
    const board = reduceBoard(emptyBoard, createEvent());
    const deleted = reduceBoard(board, { seq: 2, type: 'card.delete', payload: { id: cardId } });
    expect(deleted.cards).toEqual([]);
  });

  it('ignores an unknown event type', () => {
    const board = reduceBoard(emptyBoard, createEvent());
    const unchanged = reduceBoard(board, { seq: 2, type: 'unknown.thing', payload: {} });
    expect(unchanged).toBe(board);
  });

  it('phase.next, phase.skip and phase.back all just adopt the broadcast target phase', () => {
    for (const type of ['phase.next', 'phase.skip', 'phase.back']) {
      const board = reduceBoard(emptyBoard, { seq: 1, type, payload: { phase: 'group' } });
      expect(board.phase).toBe('group');
      expect(board.columns).toBe(emptyBoard.columns); // untouched
    }
  });

  describe('RN-011: hidden cards', () => {
    it('a hidden card.create adds a placeholder with no body or authorName', () => {
      const board = reduceBoard(emptyBoard, { seq: 1, type: 'card.create', payload: hiddenPayload() });
      expect(board.cards).toEqual([{ id: cardId, columnId, authorId, position: 'a0', hidden: true }]);
    });

    it('a hidden echo never clobbers a card we already hold in full (the author\'s own optimistic copy)', () => {
      const withFullCard = reduceBoard(emptyBoard, createEvent());
      const afterHiddenEcho = reduceBoard(withFullCard, { seq: 2, type: 'card.create', payload: hiddenPayload() });
      expect(afterHiddenEcho).toBe(withFullCard); // unchanged — the hidden echo was a no-op
      expect(afterHiddenEcho.cards[0]).toMatchObject({ body: 'Ship it', hidden: false });
    });

    it('a hidden card.edit is a no-op for a non-author (the placeholder already showed nothing)', () => {
      const withHiddenCard = reduceBoard(emptyBoard, { seq: 1, type: 'card.create', payload: hiddenPayload() });
      const afterHiddenEdit = reduceBoard(withHiddenCard, { seq: 2, type: 'card.edit', payload: hiddenPayload() });
      expect(afterHiddenEdit).toEqual(withHiddenCard);
    });

    it('cards.reveal upgrades every referenced hidden card to its full version', () => {
      const withHiddenCard = reduceBoard(emptyBoard, { seq: 1, type: 'card.create', payload: hiddenPayload() });
      const fullCard = {
        id: cardId,
        columnId,
        authorId,
        authorName: 'Ada',
        body: 'The real text',
        position: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        hidden: false,
      };
      const revealed = reduceBoard(withHiddenCard, { seq: 2, type: 'cards.reveal', payload: { cards: [fullCard] } });
      expect(revealed.cardsRevealed).toBe(true);
      expect(revealed.cards).toEqual([fullCard]);
    });

    it('cards.reveal leaves a card not in its list untouched', () => {
      const withHiddenCard = reduceBoard(emptyBoard, { seq: 1, type: 'card.create', payload: hiddenPayload() });
      const revealed = reduceBoard(withHiddenCard, { seq: 2, type: 'cards.reveal', payload: { cards: [] } });
      expect(revealed.cards).toEqual(withHiddenCard.cards);
      expect(revealed.cardsRevealed).toBe(true);
    });
  });
});
