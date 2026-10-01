import { describe, expect, it } from 'vitest';
import type { RetroPhase } from './retros.js';
import { allowedActions, footerHint, nextPhase, phaseDurationMinutes, phaseSubtitle, previousPhase } from './stateMachine.js';

const ALL_PHASES: RetroPhase[] = ['setup', 'review', 'write', 'group', 'vote', 'discuss', 'wrap_up', 'closed'];

describe('nextPhase', () => {
  it('walks the canonical sequence forward', () => {
    expect(nextPhase('review')).toBe('write');
    expect(nextPhase('write')).toBe('group');
    expect(nextPhase('group')).toBe('vote');
    expect(nextPhase('vote')).toBe('discuss');
    expect(nextPhase('discuss')).toBe('wrap_up');
    expect(nextPhase('wrap_up')).toBe('closed');
  });

  it('rejects advancing from the terminal phase, and from setup (never a live phase)', () => {
    expect(nextPhase('closed')).toBeNull();
    expect(nextPhase('setup')).toBeNull();
  });
});

describe('previousPhase', () => {
  it('allows exactly the two documented one-step-back transitions', () => {
    expect(previousPhase('group')).toBe('write');
    expect(previousPhase('vote')).toBe('group');
  });

  it('rejects going back from every other phase', () => {
    for (const phase of ALL_PHASES) {
      if (phase === 'group' || phase === 'vote') continue;
      expect(previousPhase(phase)).toBeNull();
    }
  });
});

describe('allowedActions — every cell of the Design 6.1 matrix', () => {
  it('review: only action-item review and edit', () => {
    const a = allowedActions('review');
    expect(a).toMatchObject({
      cardCrud: false,
      cardDrag: 'none',
      cardReact: 'never',
      cardGroup: false,
      vote: false,
      actionItemReview: true,
      actionItemEdit: true,
      summaryEdit: false,
    });
  });

  it('write: card CRUD, drag own cards only, react after reveal', () => {
    const a = allowedActions('write');
    expect(a).toMatchObject({
      cardCrud: true,
      cardDrag: 'own',
      cardReact: 'after_reveal',
      cardGroup: false,
      vote: false,
      actionItemReview: false,
      actionItemEdit: false,
      summaryEdit: false,
    });
  });

  it('group: card CRUD, drag any card, react always, grouping', () => {
    const a = allowedActions('group');
    expect(a).toMatchObject({
      cardCrud: true,
      cardDrag: 'all',
      cardReact: 'always',
      cardGroup: true,
      vote: false,
      actionItemReview: false,
      actionItemEdit: false,
      summaryEdit: false,
    });
  });

  it('vote: only voting', () => {
    const a = allowedActions('vote');
    expect(a).toMatchObject({
      cardCrud: false,
      cardDrag: 'none',
      cardReact: 'never',
      cardGroup: false,
      vote: true,
      actionItemReview: false,
      actionItemEdit: false,
      summaryEdit: false,
    });
  });

  it('discuss: react, action items and summaries', () => {
    const a = allowedActions('discuss');
    expect(a).toMatchObject({
      cardCrud: false,
      cardDrag: 'none',
      cardReact: 'always',
      cardGroup: false,
      vote: false,
      actionItemReview: false,
      actionItemEdit: true,
      summaryEdit: true,
    });
  });

  it('wrap_up: same as discuss', () => {
    const a = allowedActions('wrap_up');
    expect(a).toMatchObject({
      cardCrud: false,
      cardDrag: 'none',
      cardReact: 'always',
      cardGroup: false,
      vote: false,
      actionItemReview: false,
      actionItemEdit: true,
      summaryEdit: true,
    });
  });

  it('setup and closed: nothing is allowed', () => {
    for (const phase of ['setup', 'closed'] as const) {
      expect(allowedActions(phase)).toMatchObject({
        cardCrud: false,
        cardDrag: 'none',
        cardReact: 'never',
        cardGroup: false,
        vote: false,
        actionItemReview: false,
        actionItemEdit: false,
        summaryEdit: false,
      });
    }
  });
});

describe('phaseSubtitle', () => {
  it('matches the story-specified examples verbatim', () => {
    expect(phaseSubtitle('review')).toBe('Reviewing previous action items');
    expect(phaseSubtitle('vote')).toBe('Voting in progress');
    expect(phaseSubtitle('wrap_up')).toBe('Wrapping up');
  });

  it('gives every phase a distinct, non-empty subtitle', () => {
    const subtitles = ALL_PHASES.map(phaseSubtitle);
    expect(new Set(subtitles).size).toBe(ALL_PHASES.length);
    for (const subtitle of subtitles) expect(subtitle.length).toBeGreaterThan(0);
  });
});

describe('footerHint', () => {
  it('matches the story-specified Write copy verbatim (RN-011)', () => {
    expect(footerHint('write')).toBe('Add cards to each column · your notes are private until the next phase');
  });

  it('matches the story-specified Group copy verbatim (RN-015)', () => {
    expect(footerHint('group')).toBe('Drag a card onto another to group them');
  });

  it('is null for every other phase — no story has specified their copy yet', () => {
    for (const phase of ALL_PHASES) {
      if (phase === 'write' || phase === 'group') continue;
      expect(footerHint(phase)).toBeNull();
    }
  });
});

describe('phaseDurationMinutes', () => {
  it('matches the decided defaults (RN-012, decision Sep 29)', () => {
    expect(phaseDurationMinutes('review')).toBe(5);
    expect(phaseDurationMinutes('write')).toBe(5);
    expect(phaseDurationMinutes('group')).toBe(5);
    expect(phaseDurationMinutes('vote')).toBe(3);
    expect(phaseDurationMinutes('discuss')).toBe(30);
    expect(phaseDurationMinutes('wrap_up')).toBe(5);
  });

  it('is null for setup and closed — neither ever gets a countdown', () => {
    expect(phaseDurationMinutes('setup')).toBeNull();
    expect(phaseDurationMinutes('closed')).toBeNull();
  });
});
