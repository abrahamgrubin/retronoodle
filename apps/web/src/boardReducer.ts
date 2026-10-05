import type {
  ActionItem,
  ActionItemCreateResult,
  ActionItemUpdateResult,
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
  TopicQueueResult,
  TopicRenameResult,
  QueueReorderResult,
  TopicEditGroupSummaryResult,
  NoteUpsertResult,
  TopicEditSummaryResult,
  TopicSummary,
  VisibleBoardCard,
  VoteAddResult,
  VoteRemoveResult,
  VotingProgress,
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
  // RN-018: "set by the facilitator before Vote".
  voteBudget: number;
  // RN-018: the viewer's own dot counts only, keyed by topicId — "Hidden card text and votes
  // never leave the server" applies to votes too, so there is no equivalent map for anyone
  // else's votes anywhere in this state. A topic with 0 votes from this viewer is simply absent.
  myVotes: Record<string, number>;
  // RN-018: "5 of 8 done voting" — null outside Vote, where the concept doesn't apply at all.
  votingProgress: VotingProgress | null;
  // RN-021: the latest generation of each topic's AI summary — absent means "nothing yet" (still
  // summarizing, or never discussed), same convention as myVotes above. Keyed by topicId via
  // `.topicId` on each entry, not a separate map — small enough lists that find() is fine, and it
  // keeps this array the same shape BoardResponse.topicSummaries already is.
  topicSummaries: TopicSummary[];
  // RN-021: "the panel shows Retry" — topics whose most recent generation attempt failed (both
  // models). Purely a local, transient flag; never persisted, never in BoardResponse. Cleared the
  // moment a new summary arrives for that topic, or optimistically on Regenerate.
  summaryUnavailableTopicIds: string[];
  // RN-022: scoped to this retro only (see board.ts's own comment — "Review shows carried items
  // (RN-025)" is a later story's job). Renders in the Action items column instead of `cards`.
  actionItems: ActionItem[];
  // RN-022: every team member, for the owner picker — never changes mid-retro, so there's no
  // reducer case that ever touches this after the initial snapshot.
  teamMembers: { id: string; displayName: string }[];
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

/** actionItem.create / actionItem.update (RN-022): upsert by id, same convention as every other
 * "replace the whole thing" result in this file — a partial actionItem.update result is already
 * the full post-update item (actionItemUpdate.ts returns the whole row), never just a diff. */
function upsertActionItem(board: BoardState, actionItem: ActionItem): BoardState {
  const existing = board.actionItems.find((a) => a.id === actionItem.id);
  return {
    ...board,
    actionItems: existing
      ? board.actionItems.map((a) => (a.id === actionItem.id ? actionItem : a))
      : [...board.actionItems, actionItem],
  };
}

function upsertTopic(board: BoardState, topic: Topic): BoardState {
  const existing = board.topics.find((t) => t.id === topic.id);
  return { ...board, topics: existing ? board.topics.map((t) => (t.id === topic.id ? topic : t)) : [...board.topics, topic] };
}

/** RN-021: replaces whichever topic's summary this is (there's only ever the latest one per
 * topic — see BoardState's own comment) and clears that topic's "unavailable" flag, since a real
 * summary arriving is proof generation didn't actually fail. */
function upsertTopicSummary(board: BoardState, summary: TopicSummary): BoardState {
  const existing = board.topicSummaries.find((s) => s.topicId === summary.topicId);
  return {
    ...board,
    topicSummaries: existing
      ? board.topicSummaries.map((s) => (s.topicId === summary.topicId ? summary : s))
      : [...board.topicSummaries, summary],
    summaryUnavailableTopicIds: board.summaryUnavailableTopicIds.filter((id) => id !== summary.topicId),
  };
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
    //
    // suggestion.accept (RN-017) broadcasts this exact same shape (SuggestionAcceptResult is a
    // type alias of TopicCreateFromCardsResult) — the facilitator accepting an AI suggestion has
    // identical board-state effects to grouping those same cards by hand, so it folds the same
    // way. Removing the now-resolved entry from the suggestions panel is a client-local concern
    // (BoardPage.tsx), not a board-state fold.
    case 'topic.createFromCards':
    case 'suggestion.accept': {
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
    // retro.close (RN-023): the only door from wrap_up to closed (phase.next/phase.skip refuse
    // that target server-side) — same {phase, phaseDeadline} result shape, folded identically.
    case 'phase.next':
    case 'phase.skip':
    case 'phase.back':
    case 'retro.close': {
      const result = event.payload as PhaseTransitionResult;
      // RN-018: "Going back Vote→Group refunds all votes" — the server deletes every vote row on
      // this one backward transition (onTransition.ts's 'vote->group'); this is the client half of
      // that, since nothing else tells this viewer their own votes are now gone. votingProgress is
      // null outside Vote regardless of direction — the concept doesn't apply anywhere else.
      const refunded = event.type === 'phase.back' && board.phase === 'vote' && result.phase === 'group';
      return {
        ...board,
        phase: result.phase,
        phaseDeadline: result.phaseDeadline,
        myVotes: refunded ? {} : board.myVotes,
        votingProgress: result.phase === 'vote' ? board.votingProgress : null,
      };
    }
    // phase.extend (RN-012): only the deadline changes, not the phase itself.
    case 'phase.extend': {
      const result = event.payload as PhaseExtendResult;
      return { ...board, phaseDeadline: result.phaseDeadline };
    }
    // vote.add / vote.remove (RN-018): two different shapes arrive here depending on who's
    // receiving it (pipeline.ts's actorPrivateResult) — the voter's own private echo is the full
    // VoteAddResult/VoteRemoveResult ({topicId, myCount, remaining, progress}), while everyone
    // else's shared-channel copy is already reduced to just `progress` (VotingProgress) before
    // it ever reaches here. `'topicId' in result` tells them apart; only the full shape has
    // anything to say about a specific topic, so only it touches `myVotes`.
    case 'vote.add':
    case 'vote.remove': {
      const result = event.payload as (VoteAddResult | VoteRemoveResult) | VotingProgress;
      if ('topicId' in result) {
        const myVotes = { ...board.myVotes };
        if (result.myCount > 0) myVotes[result.topicId] = result.myCount;
        else delete myVotes[result.topicId];
        return { ...board, myVotes, votingProgress: result.progress };
      }
      return { ...board, votingProgress: result };
    }
    // topic.next / topic.setCurrent (RN-019): both end whichever topic was current (if any) and
    // start a new one (or nothing — "Finish discussion"). Full `Topic`s either way (never
    // redacted — nothing about a topic is hidden once Discuss starts), so this just upserts
    // whichever of the two sides is non-null; no separate "current topic" field to keep in sync
    // anywhere else in this state (see topics.ts's own comment — it's derived from startedAt/
    // endedAt on the topic itself).
    case 'topic.next':
    case 'topic.setCurrent': {
      const result = event.payload as TopicQueueResult;
      let next = board;
      if (result.endedTopic) next = upsertTopic(next, result.endedTopic);
      if (result.startedTopic) next = upsertTopic(next, result.startedTopic);
      return next;
    }
    // queue.reorder (RN-019): only `discussionOrder` changed — still the full topic, folded the
    // same way as topic.rename.
    case 'queue.reorder': {
      const result = event.payload as QueueReorderResult;
      return upsertTopic(board, result.topic);
    }
    // topic.editGroupSummary (homework): the facilitator's edit — a normal mutation (real seq,
    // goes through the shared retro channel like any other), unlike the two AI agents' own
    // one-shot worker broadcasts below, which never go through this reducer at all (see
    // BoardPage.tsx's retro-channel listener — they're applied as local patches instead, since
    // they carry no real seq to fold here).
    case 'topic.editGroupSummary': {
      const result = event.payload as TopicEditGroupSummaryResult;
      return upsertTopic(board, result.topic);
    }
    // note.upsert (RN-020): "notes save automatically and appear for everyone" — a normal
    // mutation (real seq), folded the same way as topic.rename/queue.reorder.
    case 'note.upsert': {
      const result = event.payload as NoteUpsertResult;
      return upsertTopic(board, result.topic);
    }
    // topic.editSummary (RN-021): a normal mutation (real seq) — the facilitator's edit overwrites
    // the latest summary in place, same "replace the whole thing" convention as every other
    // topic-shaped result in this file.
    case 'topic.editSummary': {
      const result = event.payload as TopicEditSummaryResult;
      return upsertTopicSummary(board, result.summary);
    }
    // topic.regenerateSummary (RN-021): this mutation's own result never carries a new summary —
    // the job is still running when it resolves. All there is to fold here is "whatever used to
    // be marked unavailable for this topic isn't anymore, we just asked again" (optimistic); the
    // real new version arrives later via topic.summaryReady below.
    case 'topic.regenerateSummary': {
      const { topicId } = event.payload as { topicId: string };
      return { ...board, summaryUnavailableTopicIds: board.summaryUnavailableTopicIds.filter((id) => id !== topicId) };
    }
    // suggestion.reject (RN-017): nothing board-wide changes (no card or topic is touched) —
    // this reaches every participant's shared channel like any other mutation, but it never
    // meant anything to anyone but the facilitator in the first place (suggestions are never
    // sent to anyone else), so there's genuinely nothing to fold here. Listed explicitly rather
    // than left to `default` purely so a future reader doesn't mistake the omission for a bug.
    case 'suggestion.reject': {
      return board;
    }
    // actionItem.create / actionItem.update (RN-022): normal mutations (real seq), folded the
    // same upsert-by-id way as every other topic/card result above.
    case 'actionItem.create': {
      const result = event.payload as ActionItemCreateResult;
      return upsertActionItem(board, result.actionItem);
    }
    case 'actionItem.update': {
      const result = event.payload as ActionItemUpdateResult;
      return upsertActionItem(board, result.actionItem);
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
