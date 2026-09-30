import { describe, expect, it } from 'vitest';
import type { VisibleBoardCard } from '@retronoodle/shared';
import { isCardCurrentlyHidden, redactCard, toHiddenCard } from './redact.js';

const authorId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';

const card: VisibleBoardCard = {
  id: '00000000-0000-4000-8000-000000000003',
  columnId: '00000000-0000-4000-8000-000000000004',
  authorId,
  authorName: 'Ada',
  body: 'Secret plan',
  position: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hidden: false,
};

describe('redactCard — never returns body for a non-author during Write', () => {
  it('hides the card from a non-author during Write before reveal', () => {
    const result = redactCard(card, { viewerId: otherId, phase: 'write', cardsRevealed: false });
    expect(result).toEqual({ id: card.id, columnId: card.columnId, authorId, position: card.position, hidden: true });
    expect('body' in result).toBe(false);
    expect('authorName' in result).toBe(false);
  });

  it('never hides the card from its own author, even during Write before reveal', () => {
    const result = redactCard(card, { viewerId: authorId, phase: 'write', cardsRevealed: false });
    expect(result).toBe(card);
  });

  it('shows the full card once reveal has happened, still in Write', () => {
    const result = redactCard(card, { viewerId: otherId, phase: 'write', cardsRevealed: true });
    expect(result).toBe(card);
  });

  it('shows the full card in every phase after Write, regardless of cardsRevealed', () => {
    for (const phase of ['group', 'vote', 'discuss', 'wrap_up', 'closed'] as const) {
      const result = redactCard(card, { viewerId: otherId, phase, cardsRevealed: false });
      expect(result).toBe(card);
    }
  });

  it('hides from a broadcast with no single viewer (the shared retro channel) during Write', () => {
    const result = redactCard(card, { viewerId: undefined, phase: 'write', cardsRevealed: false });
    expect(result).toMatchObject({ hidden: true });
  });
});

describe('isCardCurrentlyHidden', () => {
  it('is true only during Write before reveal', () => {
    expect(isCardCurrentlyHidden({ phase: 'write', cardsRevealed: false })).toBe(true);
    expect(isCardCurrentlyHidden({ phase: 'write', cardsRevealed: true })).toBe(false);
    expect(isCardCurrentlyHidden({ phase: 'group', cardsRevealed: false })).toBe(false);
  });
});

describe('toHiddenCard', () => {
  it('strips body, authorName, createdAt and updatedAt', () => {
    expect(toHiddenCard(card)).toEqual({
      id: card.id,
      columnId: card.columnId,
      authorId: card.authorId,
      position: card.position,
      hidden: true,
    });
  });
});
