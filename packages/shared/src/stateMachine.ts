import type { RetroPhase } from './retros.js';

/** The walked sequence a retro actually moves through (RN-010). A retro never sits in `setup` —
 * its initial phase is decided at creation time (review, if the team has carried-over action
 * items; write otherwise) — and `closed` is terminal, so neither appears here as a "from". */
const PHASE_ORDER: RetroPhase[] = ['review', 'write', 'group', 'vote', 'discuss', 'wrap_up', 'closed'];

/** `phase.next`/`phase.skip` (RN-010: both mutations resolve to the same target — "skip" is the
 * same forward step as "next", just invoked from the phase timer's Skip button (RN-012) instead
 * of the facilitator saying they're done). Null means there's nowhere forward to go. */
export function nextPhase(phase: RetroPhase): RetroPhase | null {
  const index = PHASE_ORDER.indexOf(phase);
  if (index === -1 || index === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[index + 1]!;
}

/** `phase.back` (RN-010: "one step only (Group→Write, Vote→Group)"). Every other phase has no
 * back target — going back further than one step, or from a phase not listed here, is rejected. */
export function previousPhase(phase: RetroPhase): RetroPhase | null {
  if (phase === 'group') return 'write';
  if (phase === 'vote') return 'group';
  return null;
}

export type CardDragScope = 'none' | 'own' | 'all';
export type CardReactScope = 'never' | 'after_reveal' | 'always';

/** One row per action in the Design 6.1 matrix (CLAUDE.md's "Phase rules" table), one column per
 * phase. `allowedActions(phase)` returns the column for that phase; every call site checks the
 * one field it cares about rather than re-encoding the table itself (RN-010: "Web uses the same
 * function to show or hide controls" — the server uses it too, to reject the mutation). */
export interface PhaseActions {
  /** Add, edit or delete your own card. */
  cardCrud: boolean;
  /** Drag cards. */
  cardDrag: CardDragScope;
  /** React to cards. */
  cardReact: CardReactScope;
  /** Group cards, accept AI groups. */
  cardGroup: boolean;
  /** Vote. */
  vote: boolean;
  /** Mark past action items. */
  actionItemReview: boolean;
  /** Create or edit action items. */
  actionItemEdit: boolean;
  /** Edit summaries, typed notes. */
  summaryEdit: boolean;
}

const NONE: PhaseActions = {
  cardCrud: false,
  cardDrag: 'none',
  cardReact: 'never',
  cardGroup: false,
  vote: false,
  actionItemReview: false,
  actionItemEdit: false,
  summaryEdit: false,
};

const PHASE_ACTIONS: Record<RetroPhase, PhaseActions> = {
  setup: NONE,
  review: { ...NONE, actionItemReview: true, actionItemEdit: true },
  write: { ...NONE, cardCrud: true, cardDrag: 'own', cardReact: 'after_reveal' },
  group: { ...NONE, cardCrud: true, cardDrag: 'all', cardReact: 'always', cardGroup: true },
  vote: { ...NONE, vote: true },
  discuss: { ...NONE, cardReact: 'always', actionItemEdit: true, summaryEdit: true },
  wrap_up: { ...NONE, cardReact: 'always', actionItemEdit: true, summaryEdit: true },
  closed: NONE,
};

export function allowedActions(phase: RetroPhase): PhaseActions {
  return PHASE_ACTIONS[phase];
}

/** Header subtitle text (RN-010 AC: "Header subtitle changes per phase"). The review/vote/
 * wrap_up strings are the story's own examples, verbatim. */
const PHASE_SUBTITLES: Record<RetroPhase, string> = {
  setup: 'Setting up',
  review: 'Reviewing previous action items',
  write: 'Adding cards to each column',
  group: 'Grouping similar cards',
  vote: 'Voting in progress',
  discuss: 'Discussing topics',
  wrap_up: 'Wrapping up',
  closed: 'Retro closed',
};

export function phaseSubtitle(phase: RetroPhase): string {
  return PHASE_SUBTITLES[phase];
}

/** Footer hint line (RN-009's layout note, first given real copy by RN-011). Only Write's text
 * is specified by a story so far — every other phase gets its footer hint from whichever later
 * story defines it; returning null here means the footer renders nothing rather than invented
 * copy. */
export function footerHint(phase: RetroPhase): string | null {
  if (phase === 'write') return 'Add cards to each column · your notes are private until the next phase';
  // RN-015 layout spec, verbatim.
  if (phase === 'group') return 'Drag a card onto another to group them';
  return null;
}

/** Default countdown length per phase (RN-012, decision Sep 29 — the mock's 03:00/02:00/01:30
 * are illustrative only). `null` means the phase has no timer (setup, closed): entering it never
 * sets `retros.phase_deadline`, and phase.extend rejects there. Discuss's 30 is a total for the
 * whole phase, not per topic — there's no per-topic time allocation in v0.1. */
const PHASE_DURATION_MINUTES: Record<RetroPhase, number | null> = {
  setup: null,
  review: 5,
  write: 5,
  group: 5,
  vote: 3,
  discuss: 30,
  wrap_up: 5,
  closed: null,
};

export function phaseDurationMinutes(phase: RetroPhase): number | null {
  return PHASE_DURATION_MINUTES[phase];
}
