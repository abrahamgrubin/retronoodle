import { z } from 'zod';
import { RetroPhase } from './retros.js';
import { VisibleBoardCard } from './board.js';
import { Topic } from './topics.js';
import { Emoji } from './reactions.js';
import { TopicSummary, TopicSummaryPoint } from './topicSummaries.js';
import { ActionItem, ActionItemOrigin } from './actionItems.js';

/** POST /retros/:id/mutations body (RN-008). Every mutation type has its own payload schema
 * below; the envelope itself only knows the type name and a client-generated mutationId used
 * for idempotency (replaying the same mutationId returns the original result, unapplied again). */
export const MutationEnvelope = z.object({
  mutationId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.unknown(),
});
export type MutationEnvelope = z.infer<typeof MutationEnvelope>;

export const MutationResponse = z.object({
  seq: z.number().int().positive(),
  result: z.unknown(),
});
export type MutationResponse = z.infer<typeof MutationResponse>;

/** RN-009: "empty body is rejected client and server side" / a 501-character body is rejected. */
export const CardBody = z.string().min(1).max(500);

export const CardCreatePayload = z.object({
  cardId: z.string().uuid(),
  columnId: z.string().uuid(),
  body: CardBody,
});
export type CardCreatePayload = z.infer<typeof CardCreatePayload>;

// Both create and edit return the full card, VisibleBoardCard-shaped (RN-011: redact() needs a
// stable, complete input — id/columnId/authorId/position at minimum — to build the hidden
// broadcast shape, so there's no separate, leaner "just what changed" result type here).
export const CardCreateResult = VisibleBoardCard;
export type CardCreateResult = VisibleBoardCard;

export const CardEditPayload = z.object({
  cardId: z.string().uuid(),
  body: CardBody,
});
export type CardEditPayload = z.infer<typeof CardEditPayload>;

export const CardEditResult = VisibleBoardCard;
export type CardEditResult = VisibleBoardCard;

export const CardDeletePayload = z.object({
  cardId: z.string().uuid(),
});
export type CardDeletePayload = z.infer<typeof CardDeletePayload>;

export const CardDeleteResult = z.object({
  id: z.string().uuid(),
});
export type CardDeleteResult = z.infer<typeof CardDeleteResult>;

/** `card.move` (RN-014): one mutation per drop — reordering within a column and moving across
 * columns are the same shape, distinguished only by whether `columnId` changed. `position` is a
 * fractional-indexing text key computed client-side (dnd-kit knows the drop target's neighbor
 * cards; the server just stores what it's given, the same way card.create's position — appended
 * after the last card — is server-computed because *that* story has no drop target to derive it
 * from). Redactable like create/edit (RN-011): a hidden card's own author moving it during Write
 * must not leak its body to everyone else on the shared channel. */
export const CardMovePayload = z.object({
  cardId: z.string().uuid(),
  columnId: z.string().uuid(),
  position: z.string().min(1),
});
export type CardMovePayload = z.infer<typeof CardMovePayload>;

/** RN-015: a drop always places a card by position, so it always leaves whatever group it was
 * in — "dropping between cards still moves rather than groups" / "dragging a card out of a group
 * removes it" are the same rule seen from two stories. `dissolvedTopic` is set when that departure
 * leaves the old group with a single card ("a one-card group dissolves") — the one other card
 * whose membership silently changed as a result, reported here since a plain card.move result
 * only ever describes the card that was actually dragged. */
const DissolvedTopic = z.object({ topicId: z.string().uuid(), remainingCard: VisibleBoardCard });
export type DissolvedTopic = z.infer<typeof DissolvedTopic>;

export const CardMoveResult = z.object({
  card: VisibleBoardCard,
  dissolvedTopic: DissolvedTopic.nullable(),
});
export type CardMoveResult = z.infer<typeof CardMoveResult>;

/** `topic.createFromCards` (RN-015): dropping card A onto card B's center when neither is
 * already grouped. `cardIds` is always exactly the two cards involved in practice (the drop
 * target and the card dropped on it, or the same pair via the "Group with…" menu) — left as a
 * general array rather than a fixed pair since nothing about the mutation itself requires
 * exactly two, and `name` defaults server-side (`defaultTopicName`, topics.ts) when omitted. */
export const TopicCreateFromCardsPayload = z.object({
  topicId: z.string().uuid(),
  cardIds: z.array(z.string().uuid()).min(2),
  name: z.string().trim().min(1).max(200).optional(),
});
export type TopicCreateFromCardsPayload = z.infer<typeof TopicCreateFromCardsPayload>;

export const TopicCreateFromCardsResult = z.object({
  topic: Topic,
  cards: z.array(VisibleBoardCard),
});
export type TopicCreateFromCardsResult = z.infer<typeof TopicCreateFromCardsResult>;

/** `card.addToTopic` (RN-015): dropping a card onto a card that's already part of a group, or
 * picking an already-grouped card from the "Group with…" menu. Can itself dissolve the card's
 * *previous* group the same way card.move can (see DissolvedTopic above) — joining a different
 * group is still a departure from whichever one it was in before. */
export const CardAddToTopicPayload = z.object({
  cardId: z.string().uuid(),
  topicId: z.string().uuid(),
});
export type CardAddToTopicPayload = z.infer<typeof CardAddToTopicPayload>;

export const CardAddToTopicResult = z.object({
  topic: Topic,
  card: VisibleBoardCard,
  dissolvedTopic: DissolvedTopic.nullable(),
});
export type CardAddToTopicResult = z.infer<typeof CardAddToTopicResult>;

/** `topic.rename` (RN-015): "Anyone can rename a group; the last rename wins" — no ownership
 * check, just the same Group-phase `cardGroup` gate grouping itself uses. */
export const TopicRenamePayload = z.object({
  topicId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
});
export type TopicRenamePayload = z.infer<typeof TopicRenamePayload>;

export const TopicRenameResult = z.object({
  topic: Topic,
});
export type TopicRenameResult = z.infer<typeof TopicRenameResult>;

/** `reaction.toggle` (RN-016): one call flips membership — adds the reaction if the caller
 * hadn't reacted with this emoji yet, removes it if they had. `added` tells every other client
 * which way it went; there's no separate add/remove mutation type. */
export const ReactionTogglePayload = z.object({
  cardId: z.string().uuid(),
  emoji: Emoji,
});
export type ReactionTogglePayload = z.infer<typeof ReactionTogglePayload>;

export const ReactionToggleResult = z.object({
  cardId: z.string().uuid(),
  userId: z.string().uuid(),
  emoji: Emoji,
  added: z.boolean(),
});
export type ReactionToggleResult = z.infer<typeof ReactionToggleResult>;

/** `phase.next`, `phase.back`, `phase.skip` (RN-010): the target phase is always derived from
 * the retro's current phase server-side (via stateMachine's nextPhase/previousPhase), never
 * supplied by the caller, so there's nothing to carry in the payload. */
export const PhaseTransitionPayload = z.object({}).strict();
export type PhaseTransitionPayload = z.infer<typeof PhaseTransitionPayload>;

export const PhaseTransitionResult = z.object({
  phase: RetroPhase,
  // RN-012: every transition sets a fresh deadline for the phase it lands on (its own default
  // duration) — null only for setup/closed, neither of which nextPhase/previousPhase ever
  // actually returns as a target, but the type stays honest about stateMachine's own shape.
  phaseDeadline: z.string().nullable(),
});
export type PhaseTransitionResult = z.infer<typeof PhaseTransitionResult>;

/** `retro.close` (RN-023): the one way wrap_up ever reaches `closed` — `phase.next`/`phase.skip`
 * explicitly refuse that specific target (phaseNext.ts) so this F2 check can't be bypassed.
 * `nextRetroAt` is always sent (the dialog prefills it from the team's cadence, but the
 * facilitator can change it); `override` is only ever true from the dialog's "Close anyway"
 * button, shown only once an ownerless item already made that visible. The result is just a
 * phase transition to 'closed' — same shape as phase.next/back/skip, nothing close-specific to
 * report back (closed_with_override is persisted, never displayed). */
export const RetroClosePayload = z.object({
  nextRetroAt: z.string(),
  override: z.boolean(),
});
export type RetroClosePayload = z.infer<typeof RetroClosePayload>;

/** `cards.reveal` (RN-011): facilitator-only, Write phase only. Broadcasts every card in full —
 * this is the one mutation type that's deliberately never passed through redact(). */
export const CardsRevealPayload = z.object({}).strict();
export type CardsRevealPayload = z.infer<typeof CardsRevealPayload>;

export const CardsRevealResult = z.object({
  cards: z.array(VisibleBoardCard),
});
export type CardsRevealResult = z.infer<typeof CardsRevealResult>;

/** `phase.extend` (RN-012): facilitator-only. Adds `minutes` to the current phase's countdown —
 * from now, not from the stale deadline, if the timer had already hit zero. */
export const PhaseExtendPayload = z.object({
  minutes: z.union([z.literal(1), z.literal(2), z.literal(5)]),
});
export type PhaseExtendPayload = z.infer<typeof PhaseExtendPayload>;

export const PhaseExtendResult = z.object({
  phaseDeadline: z.string(),
});
export type PhaseExtendResult = z.infer<typeof PhaseExtendResult>;

/** `suggestion.accept` (RN-017): the facilitator accepting an AI-suggested group — the resulting
 * effect is identical to `topic.createFromCards` (same shape returned, same board-state fold),
 * just sourced from a stored suggestion's name/cardIds instead of the caller's own payload. */
export const SuggestionAcceptPayload = z.object({
  suggestionId: z.string().uuid(),
});
export type SuggestionAcceptPayload = z.infer<typeof SuggestionAcceptPayload>;

export const SuggestionAcceptResult = TopicCreateFromCardsResult;
export type SuggestionAcceptResult = TopicCreateFromCardsResult;

/** `suggestion.reject` (RN-017): facilitator only, discards one suggestion. Nothing board-wide
 * changes, so other participants' boards have nothing to fold from this — see boardReducer.ts. */
export const SuggestionRejectPayload = z.object({
  suggestionId: z.string().uuid(),
});
export type SuggestionRejectPayload = z.infer<typeof SuggestionRejectPayload>;

export const SuggestionRejectResult = z.object({
  suggestionId: z.string().uuid(),
});
export type SuggestionRejectResult = z.infer<typeof SuggestionRejectResult>;

/** `topic.next` / `topic.setCurrent` (RN-019): both end whichever topic is currently current (if
 * any — `null` when nothing was) and start a new one (`null` when there's nothing left to start,
 * i.e. "Finish discussion"). "Next" advances to the first never-discussed topic in queue order;
 * "jump" (setCurrent) goes to whichever topic the facilitator picked, possibly one already
 * discussed — same result shape either way. */
export const TopicQueueResult = z.object({
  endedTopic: Topic.nullable(),
  startedTopic: Topic.nullable(),
});
export type TopicQueueResult = z.infer<typeof TopicQueueResult>;

export const TopicNextPayload = z.object({}).strict();
export type TopicNextPayload = z.infer<typeof TopicNextPayload>;

export const TopicSetCurrentPayload = z.object({
  topicId: z.string().uuid(),
});
export type TopicSetCurrentPayload = z.infer<typeof TopicSetCurrentPayload>;

/** `queue.reorder` (RN-019): "text sort keys" — the facilitator drags a not-yet-discussed topic
 * to a new spot in the Up next list; the client computes the fractional key the same way
 * card.move computes `position`, and this just writes it (same division of labor as
 * cardMove.ts). Rejected for a topic that's already started (current or already discussed) —
 * reordering only ever applies to what's still ahead. */
export const QueueReorderPayload = z.object({
  topicId: z.string().uuid(),
  discussionOrder: z.string().min(1),
});
export type QueueReorderPayload = z.infer<typeof QueueReorderPayload>;

export const QueueReorderResult = z.object({
  topic: Topic,
});
export type QueueReorderResult = z.infer<typeof QueueReorderResult>;

/** `topic.editGroupSummary` (homework): facilitator-only, Vote phase only — overwrites
 * group-summarizer's output with the facilitator's own text, whether the agent already ran or
 * not (there's no special-case for "writing one from scratch" vs. "editing the AI's draft"). */
export const TopicEditGroupSummaryPayload = z.object({
  topicId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(1000),
});
export type TopicEditGroupSummaryPayload = z.infer<typeof TopicEditGroupSummaryPayload>;

export const TopicEditGroupSummaryResult = z.object({
  topic: Topic,
});
export type TopicEditGroupSummaryResult = z.infer<typeof TopicEditGroupSummaryResult>;

/** `note.upsert` (RN-020): "type quick notes on the current topic... debounced 800ms" — the
 * debounce itself is client-side (BoardPage.tsx); this is just the write. No ownership/role
 * check beyond the phase gate (Discuss/Wrap up) — unlike RN-019's queue mutations, this story's
 * own technical notes never say "facilitator-only," same "anyone" default as topic.rename. */
export const NoteUpsertPayload = z.object({
  topicId: z.string().uuid(),
  body: z.string().max(4000),
});
export type NoteUpsertPayload = z.infer<typeof NoteUpsertPayload>;

export const NoteUpsertResult = z.object({
  topic: Topic,
});
export type NoteUpsertResult = z.infer<typeof NoteUpsertResult>;

/** `topic.editSummary` (RN-021): "Edit and Regenerate buttons (facilitator only)" — overwrites
 * the latest `topic_summaries` row's four sections in place (no new version row — "edits save as
 * the final version") and marks it `edited`. Same facilitator-only gate as
 * `topic.editGroupSummary` (`retro.editAiSummary`), same Discuss/Wrap-up phase gate as
 * `note.upsert` (`summaryEdit`). */
export const TopicEditSummaryPayload = z.object({
  topicId: z.string().uuid(),
  keyPoints: z.array(TopicSummaryPoint),
  decisions: z.array(TopicSummaryPoint),
  disagreements: z.array(TopicSummaryPoint),
  proposedActionItems: z.array(TopicSummaryPoint),
});
export type TopicEditSummaryPayload = z.infer<typeof TopicEditSummaryPayload>;

export const TopicEditSummaryResult = z.object({
  summary: TopicSummary,
});
export type TopicEditSummaryResult = z.infer<typeof TopicEditSummaryResult>;

/** `topic.regenerateSummary` (RN-021): re-enqueues `ai.summarizeTopic` for a topic that already
 * has a summary — "each regenerate creates a new version row," written later by the job itself
 * once generation actually finishes. This mutation only ever acknowledges the request; "Replace
 * your edits?" is a client-side confirm before it's even sent (BoardPage.tsx), not a server
 * concern. Same gates as topic.editSummary. */
export const TopicRegenerateSummaryPayload = z.object({
  topicId: z.string().uuid(),
});
export type TopicRegenerateSummaryPayload = z.infer<typeof TopicRegenerateSummaryPayload>;

export const TopicRegenerateSummaryResult = z.object({
  topicId: z.string().uuid(),
});
export type TopicRegenerateSummaryResult = z.infer<typeof TopicRegenerateSummaryResult>;

/** `actionItem.create` (RN-022): "Create from a proposed item in the summary ('Add as action
 * item') or via '+ Add a card' in the Action items column" — `origin`/`sourceTopicId` tell the
 * two apart, set by the client depending on which flow this came from, not inferred server-side.
 * `id` is browser-generated (UUIDv7), same as cards. No ownership/role check beyond the phase
 * gate (`actionItemEdit` — Review, Discuss, Wrap up) — the story never says "facilitator-only,"
 * same "anyone" default as topic.rename/note.upsert. */
export const ActionItemCreatePayload = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  sourceTopicId: z.string().uuid().nullable(),
  ownerId: z.string().uuid().nullable(),
  dueDate: z.string().nullable(),
  origin: ActionItemOrigin,
});
export type ActionItemCreatePayload = z.infer<typeof ActionItemCreatePayload>;

export const ActionItemCreateResult = z.object({
  actionItem: ActionItem,
});
export type ActionItemCreateResult = z.infer<typeof ActionItemCreateResult>;

/** `actionItem.update` (RN-022): "owner and due date are editable inline" — title is included too
 * for symmetry with every other editable entity in this app, though it's not explicitly called
 * out by the story's own ACs. Every field is optional — only the ones actually being changed are
 * sent, same partial-update shape as topic.editGroupSummary's "overwrite in place" precedent. */
export const ActionItemUpdatePayload = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(500).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});
export type ActionItemUpdatePayload = z.infer<typeof ActionItemUpdatePayload>;

export const ActionItemUpdateResult = z.object({
  actionItem: ActionItem,
});
export type ActionItemUpdateResult = z.infer<typeof ActionItemUpdateResult>;
