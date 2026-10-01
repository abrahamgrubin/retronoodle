import { describe, expect, it } from 'vitest';
import { reduceBoard, type BoardState } from './boardReducer';
import type { RetroEvent } from './retroStore';

const columnId = '00000000-0000-4000-8000-000000000001';
const cardId = '00000000-0000-4000-8000-000000000002';
const authorId = '00000000-0000-4000-8000-000000000003';

const emptyBoard: BoardState = { phase: 'write', cardsRevealed: false, phaseDeadline: null, columns: [], cards: [], topics: [] };

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
      topicId: null,
      reactions: [],
      hidden: false,
      ...overrides,
    },
  };
}

function hiddenPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: cardId, columnId, authorId, position: 'a0', topicId: null, hidden: true, ...overrides };
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

  it('card.move updates columnId and position on the matching card', () => {
    const otherColumnId = '00000000-0000-4000-8000-000000000009';
    const board = reduceBoard(emptyBoard, createEvent());
    const event = createEvent({ columnId: otherColumnId, position: 'b0' });
    const moved = reduceBoard(board, { seq: 2, type: 'card.move', payload: { card: event.payload, dissolvedTopic: null } });
    expect(moved.cards[0]).toMatchObject({ columnId: otherColumnId, position: 'b0', body: 'Ship it' });
  });

  it('card.move also folds in a dissolvedTopic (RN-015: "a one-card group dissolves")', () => {
    const otherCardId = '00000000-0000-4000-8000-00000000000a';
    const topicId = '00000000-0000-4000-8000-00000000000b';
    const board: BoardState = {
      ...emptyBoard,
      topics: [{ id: topicId, columnId, name: 'A group' }],
      cards: [
        {
          id: cardId,
          columnId,
          authorId,
          authorName: 'Ada',
          body: 'Ship it',
          position: 'a0',
          createdAt: '',
          updatedAt: '',
          topicId,
          reactions: [],
          hidden: false,
        },
        {
          id: otherCardId,
          columnId,
          authorId,
          authorName: 'Ada',
          body: 'Also here',
          position: 'a1',
          createdAt: '',
          updatedAt: '',
          topicId,
          reactions: [],
          hidden: false,
        },
      ],
    };
    const otherColumnId = '00000000-0000-4000-8000-000000000009';
    const moved = reduceBoard(board, {
      seq: 2,
      type: 'card.move',
      payload: {
        card: { ...(createEvent({ columnId: otherColumnId, position: 'b0' }).payload as Record<string, unknown>), topicId: null },
        dissolvedTopic: {
          topicId,
          remainingCard: {
            id: otherCardId,
            columnId,
            authorId,
            authorName: 'Ada',
            body: 'Also here',
            position: 'a1',
            createdAt: '',
            updatedAt: '',
            topicId: null,
            hidden: false,
          },
        },
      },
    });
    expect(moved.topics).toEqual([]);
    expect(moved.cards.find((c) => c.id === otherCardId)).toMatchObject({ topicId: null });
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

  it('phase.next, phase.skip and phase.back all just adopt the broadcast target phase and deadline', () => {
    for (const type of ['phase.next', 'phase.skip', 'phase.back']) {
      const board = reduceBoard(emptyBoard, { seq: 1, type, payload: { phase: 'group', phaseDeadline: '2026-01-01T00:05:00.000Z' } });
      expect(board.phase).toBe('group');
      expect(board.phaseDeadline).toBe('2026-01-01T00:05:00.000Z');
      expect(board.columns).toBe(emptyBoard.columns); // untouched
    }
  });

  it('phase.extend updates only the deadline, leaving the phase itself untouched', () => {
    const board = reduceBoard(emptyBoard, { seq: 1, type: 'phase.extend', payload: { phaseDeadline: '2026-01-01T00:07:00.000Z' } });
    expect(board.phase).toBe('write');
    expect(board.phaseDeadline).toBe('2026-01-01T00:07:00.000Z');
  });

  describe('RN-011: hidden cards', () => {
    it('a hidden card.create adds a placeholder with no body or authorName', () => {
      const board = reduceBoard(emptyBoard, { seq: 1, type: 'card.create', payload: hiddenPayload() });
      expect(board.cards).toEqual([{ id: cardId, columnId, authorId, position: 'a0', topicId: null, hidden: true }]);
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

    it('a hidden card.move still updates columnId/position for a non-author — unlike edit, the move itself is visible information', () => {
      const withHiddenCard = reduceBoard(emptyBoard, { seq: 1, type: 'card.create', payload: hiddenPayload() });
      const otherColumnId = '00000000-0000-4000-8000-000000000009';
      const afterHiddenMove = reduceBoard(withHiddenCard, {
        seq: 2,
        type: 'card.move',
        payload: { card: hiddenPayload({ columnId: otherColumnId, position: 'b0' }), dissolvedTopic: null },
      });
      expect(afterHiddenMove.cards).toEqual([
        { id: cardId, columnId: otherColumnId, authorId, position: 'b0', topicId: null, hidden: true },
      ]);
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

  describe('RN-015: grouping', () => {
    const otherCardId = '00000000-0000-4000-8000-00000000000a';
    const topicId = '00000000-0000-4000-8000-00000000000b';

    it('topic.createFromCards adds the topic and marks every included card with its id', () => {
      const board = reduceBoard(reduceBoard(emptyBoard, createEvent()), createEvent({ id: otherCardId, position: 'a1' }));
      const grouped = reduceBoard(board, {
        seq: 3,
        type: 'topic.createFromCards',
        payload: {
          topic: { id: topicId, columnId, name: 'Ship it' },
          cards: [
            { ...(createEvent().payload as Record<string, unknown>), topicId },
            { ...(createEvent({ id: otherCardId, position: 'a1' }).payload as Record<string, unknown>), topicId },
          ],
        },
      });
      expect(grouped.topics).toEqual([{ id: topicId, columnId, name: 'Ship it' }]);
      expect(grouped.cards.map((c) => (c as { topicId: string | null }).topicId)).toEqual([topicId, topicId]);
    });

    it('card.addToTopic adds the topic (if new to this client) and sets the card\'s topicId', () => {
      const board = reduceBoard(emptyBoard, createEvent());
      const joined = reduceBoard(board, {
        seq: 2,
        type: 'card.addToTopic',
        payload: {
          topic: { id: topicId, columnId, name: 'Existing group' },
          card: { ...(createEvent().payload as Record<string, unknown>), topicId },
          dissolvedTopic: null,
        },
      });
      expect(joined.topics).toEqual([{ id: topicId, columnId, name: 'Existing group' }]);
      expect(joined.cards[0]).toMatchObject({ topicId });
    });

    it('card.addToTopic also dissolves the card\'s previous group when that leaves it with one member', () => {
      const board: BoardState = {
        ...emptyBoard,
        topics: [{ id: topicId, columnId, name: 'Old group' }],
        cards: [
          {
            id: cardId,
            columnId,
            authorId,
            authorName: 'Ada',
            body: 'Ship it',
            position: 'a0',
            createdAt: '',
            updatedAt: '',
            topicId,
            reactions: [],
            hidden: false,
          },
          {
            id: otherCardId,
            columnId,
            authorId,
            authorName: 'Ada',
            body: 'Also here',
            position: 'a1',
            createdAt: '',
            updatedAt: '',
            topicId,
            reactions: [],
            hidden: false,
          },
        ],
      };
      const newTopicId = '00000000-0000-4000-8000-00000000000c';
      const joined = reduceBoard(board, {
        seq: 3,
        type: 'card.addToTopic',
        payload: {
          topic: { id: newTopicId, columnId, name: 'New group' },
          card: { id: cardId, columnId, authorId, authorName: 'Ada', body: 'Ship it', position: 'a0', createdAt: '', updatedAt: '', topicId: newTopicId, hidden: false },
          dissolvedTopic: {
            topicId,
            remainingCard: {
              id: otherCardId,
              columnId,
              authorId,
              authorName: 'Ada',
              body: 'Also here',
              position: 'a1',
              createdAt: '',
              updatedAt: '',
              topicId: null,
              hidden: false,
            },
          },
        },
      });
      expect(joined.topics.map((t) => t.id)).toEqual([newTopicId]);
      expect(joined.cards.find((c) => c.id === otherCardId)).toMatchObject({ topicId: null });
    });

    it("topic.rename updates the topic's name, leaving its cards untouched", () => {
      const board: BoardState = { ...emptyBoard, topics: [{ id: topicId, columnId, name: 'Old name' }] };
      const renamed = reduceBoard(board, { seq: 1, type: 'topic.rename', payload: { topic: { id: topicId, columnId, name: 'New name' } } });
      expect(renamed.topics).toEqual([{ id: topicId, columnId, name: 'New name' }]);
    });
  });

  describe('RN-016: reactions', () => {
    const viewerId = '00000000-0000-4000-8000-00000000000d';
    const otherUserId = '00000000-0000-4000-8000-00000000000e';

    it('reaction.toggle with added:true adds a new reaction entry', () => {
      const board = reduceBoard(emptyBoard, createEvent());
      const toggled = reduceBoard(board, {
        seq: 2,
        type: 'reaction.toggle',
        payload: { cardId, userId: viewerId, emoji: '👍', added: true },
      });
      expect(toggled.cards[0]).toMatchObject({ reactions: [{ emoji: '👍', userIds: [viewerId] }] });
    });

    it('a second person reacting with the same emoji joins the same entry, not a duplicate one', () => {
      const board = reduceBoard(emptyBoard, createEvent({ reactions: [{ emoji: '👍', userIds: [otherUserId] }] }));
      const toggled = reduceBoard(board, {
        seq: 2,
        type: 'reaction.toggle',
        payload: { cardId, userId: viewerId, emoji: '👍', added: true },
      });
      expect(toggled.cards[0]).toMatchObject({ reactions: [{ emoji: '👍', userIds: [otherUserId, viewerId] }] });
    });

    it('added:true is a no-op if the user is already in that reaction (idempotent replay)', () => {
      const board = reduceBoard(emptyBoard, createEvent({ reactions: [{ emoji: '👍', userIds: [viewerId] }] }));
      const toggled = reduceBoard(board, {
        seq: 2,
        type: 'reaction.toggle',
        payload: { cardId, userId: viewerId, emoji: '👍', added: true },
      });
      expect(toggled.cards[0]).toMatchObject({ reactions: [{ emoji: '👍', userIds: [viewerId] }] });
    });

    it('added:false removes just that user, leaving the entry if someone else is still in it', () => {
      const board = reduceBoard(emptyBoard, createEvent({ reactions: [{ emoji: '👍', userIds: [viewerId, otherUserId] }] }));
      const toggled = reduceBoard(board, {
        seq: 2,
        type: 'reaction.toggle',
        payload: { cardId, userId: viewerId, emoji: '👍', added: false },
      });
      expect(toggled.cards[0]).toMatchObject({ reactions: [{ emoji: '👍', userIds: [otherUserId] }] });
    });

    it('added:false removes the whole entry once its last user is gone', () => {
      const board = reduceBoard(emptyBoard, createEvent({ reactions: [{ emoji: '👍', userIds: [viewerId] }] }));
      const toggled = reduceBoard(board, {
        seq: 2,
        type: 'reaction.toggle',
        payload: { cardId, userId: viewerId, emoji: '👍', added: false },
      });
      expect(toggled.cards[0]).toMatchObject({ reactions: [] });
    });

    it("card.edit/card.move/grouping never wipe out a card's existing reactions, even though their own result always reports none", () => {
      const withReaction = reduceBoard(emptyBoard, createEvent({ reactions: [{ emoji: '🔥', userIds: [viewerId] }] }));
      const edited = reduceBoard(withReaction, createEvent({ body: 'Edited body', reactions: [] }));
      expect(edited.cards[0]).toMatchObject({ body: 'Edited body', reactions: [{ emoji: '🔥', userIds: [viewerId] }] });
    });
  });

  describe('RN-017: AI grouping suggestions', () => {
    it('suggestion.accept folds exactly like topic.createFromCards (same result shape)', () => {
      const otherCardId = '00000000-0000-4000-8000-00000000000f';
      const topicId = '00000000-0000-4000-8000-000000000010';
      const board = reduceBoard(reduceBoard(emptyBoard, createEvent()), createEvent({ id: otherCardId, position: 'a1' }));
      const grouped = reduceBoard(board, {
        seq: 3,
        type: 'suggestion.accept',
        payload: {
          topic: { id: topicId, columnId, name: 'From AI' },
          cards: [
            { ...(createEvent().payload as Record<string, unknown>), topicId },
            { ...(createEvent({ id: otherCardId, position: 'a1' }).payload as Record<string, unknown>), topicId },
          ],
        },
      });
      expect(grouped.topics).toEqual([{ id: topicId, columnId, name: 'From AI' }]);
      expect(grouped.cards.map((c) => (c as { topicId: string | null }).topicId)).toEqual([topicId, topicId]);
    });

    it('suggestion.reject is a no-op on board state (nothing board-wide ever changed)', () => {
      const board = reduceBoard(emptyBoard, createEvent());
      const rejected = reduceBoard(board, { seq: 2, type: 'suggestion.reject', payload: { suggestionId: 'whatever' } });
      expect(rejected).toBe(board);
    });
  });
});
