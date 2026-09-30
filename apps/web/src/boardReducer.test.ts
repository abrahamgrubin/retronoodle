import { describe, expect, it } from 'vitest';
import { reduceBoard, type BoardState } from './boardReducer';
import type { RetroEvent } from './retroStore';

const columnId = '00000000-0000-4000-8000-000000000001';
const cardId = '00000000-0000-4000-8000-000000000002';
const authorId = '00000000-0000-4000-8000-000000000003';

const emptyBoard: BoardState = { phase: 'write', columns: [], cards: [] };

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
      ...overrides,
    },
  };
}

describe('reduceBoard', () => {
  it('card.create appends a new card', () => {
    const board = reduceBoard(emptyBoard, createEvent());
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]).toMatchObject({ id: cardId, body: 'Ship it', authorName: 'Ada' });
  });

  it('card.create upserts (does not duplicate) when the card id already exists — the optimistic-then-confirmed case', () => {
    const afterOptimistic = reduceBoard(emptyBoard, createEvent({ body: 'Optimistic body' }));
    const afterConfirmed = reduceBoard(afterOptimistic, createEvent({ body: 'Confirmed body' }));
    expect(afterConfirmed.cards).toHaveLength(1);
    expect(afterConfirmed.cards[0]?.body).toBe('Confirmed body');
  });

  it('card.edit updates the body of the matching card only', () => {
    const board = reduceBoard(emptyBoard, createEvent());
    const edited = reduceBoard(board, {
      seq: 2,
      type: 'card.edit',
      payload: { id: cardId, body: 'Edited body' },
    });
    expect(edited.cards[0]?.body).toBe('Edited body');
    expect(edited.cards[0]?.authorName).toBe('Ada'); // untouched
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
});
