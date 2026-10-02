import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { uuidv7 } from 'uuidv7';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { generateKeyBetween } from 'fractional-indexing';
import {
  allowedActions,
  defaultTopicName,
  EMOJI_QUICK_SET,
  footerHint,
  nextPhase,
  phaseDurationMinutes,
  phaseSubtitle,
  previousPhase,
  type BoardCard,
  type BoardColumn,
  type BoardResponse,
  type Emoji,
  type GroupSuggestion,
  type ReactionSummary,
  type RetroPhase,
  type Topic,
  type VisibleBoardCard,
} from '@retronoodle/shared';
import { signInWithGoogle } from './auth';
import { fetchBoard } from './board';
import { reduceBoard, toggleReaction, type BoardState } from './boardReducer';
import { computeClockOffsetMs, formatCountdown, remainingMs } from './clock';
import { postMutation } from './mutations';
import { createRetroStore } from './retroStore';
import { supabase } from './supabaseClient';
import { useSession } from './useSession';

const MAX_CARD_LENGTH = 500;

function AddCardForm({ onAdd }: { onAdd: (body: string) => void }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_CARD_LENGTH) {
      setError(`Cards can't be longer than ${MAX_CARD_LENGTH} characters.`);
      return;
    }
    onAdd(trimmed);
    setBody('');
    setError(null);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            setBody('');
            setError(null);
          }
        }}
        placeholder="+ Add a card"
        aria-label="Add a card"
        rows={2}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
      />
      {error && (
        <p role="alert" style={{ color: 'crimson', margin: '4px 0', fontSize: 13 }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** A card hidden during Write (RN-011): "blurred placeholder showing column color and author
 * avatar" per the story — no avatar image infra exists yet, so this shows the column color and a
 * generic marker instead. Never receives body/authorName — the server never sent them. */
function HiddenCardPlaceholder({ columnColor }: { columnColor: string }) {
  return (
    <div
      style={{
        border: `1px dashed ${columnColor}`,
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        background: '#f4f4f4',
        color: '#999',
        fontStyle: 'italic',
        fontSize: 13,
      }}
    >
      Hidden until reveal
    </div>
  );
}

/** RN-016: bundled rather than four separate props, since every call site (SortableCardView,
 * TopicGroupView's per-member rendering) always supplies all four together. */
export interface ReactionBarProps {
  reactions: ReactionSummary[];
  viewerId: string;
  canReact: boolean;
  onToggleReaction: (emoji: Emoji) => void;
}

function CardView({
  card,
  canEdit,
  onEdit,
  onDelete,
  dragHandleProps,
  menu,
  reactionProps,
  highlighted,
}: {
  card: VisibleBoardCard;
  canEdit: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
  // RN-014: spread only onto the display div below, never the editing one — dnd-kit's
  // PointerSensor attaches its own pointerdown listener here, and putting that on the textarea's
  // ancestor would fight with dragging-to-select text while editing a card's body.
  dragHandleProps?: Record<string, unknown>;
  // RN-015: the "Group with…" menu — independent of canEdit (grouping has no ownership
  // restriction during Group, unlike edit/delete), so it's its own slot rather than bundled with
  // the Edit/Delete buttons below.
  menu?: ReactNode;
  reactionProps: ReactionBarProps;
  // RN-017 layout spec: "Hover: hovering a suggestion outlines its cards on the board."
  highlighted?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.body);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <div style={{ border: '1px solid #ccc', borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const trimmed = draft.trim();
              if (!trimmed) {
                setError('Card text is required.');
                return;
              }
              if (trimmed.length > MAX_CARD_LENGTH) {
                setError(`Cards can't be longer than ${MAX_CARD_LENGTH} characters.`);
                return;
              }
              onEdit(trimmed);
              setEditing(false);
              setError(null);
            } else if (e.key === 'Escape') {
              setDraft(card.body);
              setEditing(false);
              setError(null);
            }
          }}
          aria-label="Edit card"
          rows={2}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
        />
        {error && (
          <p role="alert" style={{ color: 'crimson', margin: '4px 0', fontSize: 13 }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid #ccc',
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        outline: highlighted ? '2px solid #f59e0b' : undefined,
        outlineOffset: highlighted ? -1 : undefined,
      }}
      {...dragHandleProps}
    >
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{card.body}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>{card.authorName}</p>
      <ReactionBar {...reactionProps} />
      {(canEdit || menu) && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          {canEdit && (
            <>
              <button type="button" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" onClick={onDelete}>
                Delete
              </button>
            </>
          )}
          {menu}
        </div>
      )}
    </div>
  );
}

/** Rough, human-readable names for the fixed quick-set (RN-016) — used only to make the picker's
 * "search" filter something sensible; not shown anywhere, and never sent to the server. */
const EMOJI_NAMES: Record<Emoji, string> = {
  '👍': 'thumbs up',
  '❤️': 'heart love',
  '😂': 'laugh joy lol',
  '🎉': 'party celebrate',
  '👀': 'eyes look',
  '🙌': 'raised hands praise',
  '💡': 'idea lightbulb',
  '🔥': 'fire hot',
  '😬': 'grimace awkward',
  '🤔': 'thinking hmm',
  '👏': 'clap applause',
  '🚀': 'rocket launch ship',
};

/** "Add reaction" popover (RN-016 layout note: "popover with search and a 12-emoji quick set") —
 * not a full emoji library; "search" narrows this same fixed 12 by a rough name match. Built on
 * <details>/<summary> for the same reason as CardMenu: natively keyboard-operable without any
 * custom focus handling. */
function ReactionPicker({ onPick }: { onPick: (emoji: Emoji) => void }) {
  const [query, setQuery] = useState('');
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const trimmedQuery = query.trim().toLowerCase();
  const results = trimmedQuery ? EMOJI_QUICK_SET.filter((emoji) => EMOJI_NAMES[emoji].includes(trimmedQuery)) : EMOJI_QUICK_SET;

  return (
    <details ref={detailsRef} style={{ position: 'relative' }}>
      <summary
        style={{ cursor: 'pointer', listStyle: 'none', fontSize: 12, color: '#666', border: '1px dashed #ccc', borderRadius: 999, padding: '1px 6px' }}
        aria-label="Add reaction"
      >
        + react
      </summary>
      <div
        style={{ position: 'absolute', zIndex: 1, background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: 8, marginTop: 4, width: 180 }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
        />
        {results.length === 0 && <p style={{ fontSize: 12, color: '#999', margin: 0 }}>No matches</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {results.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onPick(emoji);
                setQuery('');
                if (detailsRef.current) detailsRef.current.open = false;
              }}
              aria-label={`React with ${EMOJI_NAMES[emoji]}`}
              style={{ fontSize: 18, border: 'none', background: 'none', cursor: 'pointer', padding: 2 }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

/** One card's reaction chips plus the "Add reaction" picker (RN-016). A chip shows emoji + count
 * and gets the blue-outlined/tinted "selected" style only when the *viewer* is one of its
 * userIds (mock chip states) — clicking a chip toggles the viewer's own reaction. Rendered even
 * when `canReact` is false and there are reactions to show ("existing reaction chips stay
 * visible" during Vote — only "the picker and chip toggles are disabled"). */
function ReactionBar({ reactions, viewerId, canReact, onToggleReaction }: ReactionBarProps) {
  const visible = reactions.filter((r) => r.userIds.length > 0);
  if (visible.length === 0 && !canReact) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, alignItems: 'center' }}>
      {visible.map((r) => {
        const mine = r.userIds.includes(viewerId);
        return (
          <button
            key={r.emoji}
            type="button"
            disabled={!canReact}
            aria-pressed={mine}
            onClick={() => onToggleReaction(r.emoji)}
            style={{
              border: mine ? '1px solid #3b82f6' : '1px solid #ccc',
              background: mine ? '#eff6ff' : '#fff',
              borderRadius: 999,
              padding: '1px 8px',
              fontSize: 12,
              cursor: canReact ? 'pointer' : 'default',
            }}
          >
            {r.emoji} {r.userIds.length}
          </button>
        );
      })}
      {canReact && <ReactionPicker onPick={onToggleReaction} />}
    </div>
  );
}

/** "Group with…" (RN-015 layout spec): a searchable list of other cards in the same column,
 * picking one groups with it exactly like dropping onto that card's center would (see
 * BoardPage's groupCardWith) — the AC's keyboard fallback, since every element here (the
 * <summary> disclosure, the input, each result button) is natively focusable and operable without
 * a pointer. */
function CardMenu({
  card,
  otherCards,
  onGroupWith,
}: {
  card: VisibleBoardCard;
  otherCards: VisibleBoardCard[];
  onGroupWith: (targetCardId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const candidates = otherCards.filter((c) => !(card.topicId && c.topicId === card.topicId));
  const trimmedQuery = query.trim().toLowerCase();
  const results = trimmedQuery ? candidates.filter((c) => c.body.toLowerCase().includes(trimmedQuery)) : candidates;

  return (
    <details style={{ position: 'relative' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', fontSize: 14, color: '#666' }} aria-label="Card menu">
        ⋯
      </summary>
      <div
        style={{
          position: 'absolute',
          zIndex: 1,
          background: '#fff',
          border: '1px solid #ccc',
          borderRadius: 6,
          padding: 8,
          marginTop: 4,
          width: 220,
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Group with…"
          aria-label="Search cards to group with"
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
        />
        {results.length === 0 && <p style={{ fontSize: 12, color: '#999', margin: 0 }}>No matching cards</p>}
        {results.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onGroupWith(c.id)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 0', border: 'none', background: 'none', cursor: 'pointer' }}
          >
            {c.body.slice(0, 40)}
          </button>
        ))}
      </div>
    </details>
  );
}

/** Registers every visible card as a dnd-kit sortable item uniformly (RN-014) — `disabled` (not
 * omission) is what stops a given viewer from dragging a given card, so dnd-kit's shift/reflow
 * animations still run for everyone watching, not just the person allowed to drag. The node
 * dnd-kit measures (`setNodeRef`) stays on this stable wrapper regardless of CardView's internal
 * editing state; only the drag listeners themselves move (see CardView's dragHandleProps note). */
function SortableCardView({
  card,
  canDrag,
  canEdit,
  onEdit,
  onDelete,
  menu,
  reactionProps,
  highlighted,
}: {
  card: VisibleBoardCard;
  canDrag: boolean;
  canEdit: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
  menu?: ReactNode;
  reactionProps: ReactionBarProps;
  highlighted?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !canDrag,
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <CardView
        card={card}
        canEdit={canEdit}
        onEdit={onEdit}
        onDelete={onDelete}
        highlighted={highlighted}
        dragHandleProps={canDrag ? { ...attributes, ...listeners } : undefined}
        menu={menu}
        reactionProps={reactionProps}
      />
    </div>
  );
}

/** RN-018: "+" adds one of your votes (disabled once you have none left); "−" appears only once
 * you have at least one vote on this topic, with your own count rendered between the two. No
 * mock for this story (per CLAUDE.md's "no features from later stories" / layout-spec precedent
 * elsewhere in this file) — rendered uniformly on a group's header for both single- and
 * multi-card topics, rather than special-casing a single-card topic to show the controls "on the
 * card" per the story's literal wording (documented simplification, noted in the PR). */
function VoteControls({
  topicName,
  myCount,
  remaining,
  onAdd,
  onRemove,
}: {
  topicName: string;
  myCount: number;
  remaining: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
      <button type="button" onClick={onAdd} disabled={remaining <= 0} aria-label={`Add vote to ${topicName || 'this group'}`}>
        +
      </button>
      <span>{myCount}</span>
      {myCount > 0 && (
        <button type="button" onClick={onRemove} aria-label={`Remove vote from ${topicName || 'this group'}`}>
          −
        </button>
      )}
    </span>
  );
}

/** A group's visual container (RN-015 layout spec): "light tint of the column color with a 2px
 * border," editable name defaulting to the placeholder text, a count chip, and more-than-3
 * collapsing to the first 2 plus "+N more". Member cards stay fully interactive — each is still
 * its own SortableCardView, so dragging one back out (ungrouping it, per card.move's own
 * behavior) and the "Group with…" menu both keep working from inside a group. */
function TopicGroupView({
  topic,
  cards,
  columnColor,
  canRename,
  canDragCard,
  canEditCard,
  onRename,
  onEditCard,
  onDeleteCard,
  menuFor,
  reactionPropsFor,
  isHighlighted,
  voteControls,
  voteCountBadge,
}: {
  topic: Topic;
  cards: BoardCard[];
  columnColor: string;
  canRename: boolean;
  canDragCard: (card: BoardCard) => boolean;
  canEditCard: (card: BoardCard) => boolean;
  onRename: (name: string) => void;
  onEditCard: (cardId: string, body: string) => void;
  onDeleteCard: (cardId: string) => void;
  menuFor: (card: VisibleBoardCard) => ReactNode;
  reactionPropsFor: (card: VisibleBoardCard) => ReactionBarProps;
  isHighlighted: (card: BoardCard) => boolean;
  // RN-018: `undefined` outside Vote — there's nothing to show on this header otherwise.
  voteControls?: ReactNode;
  // RN-018: "After Vote, topics display vote counts" — `undefined` until then, since
  // `topic.voteCount` is structurally 0 (not yet revealed) everywhere before vote->discuss runs,
  // and rendering it unconditionally would make an honest zero look identical to "not revealed".
  voteCountBadge?: ReactNode;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(topic.name);
  const [expanded, setExpanded] = useState(false);
  const visibleCards = expanded ? cards : cards.slice(0, 2);
  const hiddenCount = cards.length - visibleCards.length;

  function commitRename() {
    const trimmed = draftName.trim();
    setEditingName(false);
    if (trimmed && trimmed !== topic.name) onRename(trimmed);
    else setDraftName(topic.name);
  }

  return (
    <div
      style={{
        background: `color-mix(in srgb, ${columnColor} 15%, white)`,
        border: `2px solid ${columnColor}`,
        borderRadius: 8,
        padding: 8,
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') {
                setDraftName(topic.name);
                setEditingName(false);
              }
            }}
            onBlur={commitRename}
            placeholder="Name this group"
            aria-label="Group name"
            style={{ fontWeight: 'bold', flex: 1, minWidth: 0 }}
          />
        ) : (
          <strong
            role={canRename ? 'button' : undefined}
            tabIndex={canRename ? 0 : undefined}
            onClick={() => canRename && setEditingName(true)}
            onKeyDown={(e) => {
              if (canRename && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                setEditingName(true);
              }
            }}
            style={{ cursor: canRename ? 'pointer' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {topic.name || 'Name this group'}
          </strong>
        )}
        {voteControls}
        {voteCountBadge}
        <span style={{ fontSize: 12, color: '#666', flexShrink: 0 }}>
          {cards.length} card{cards.length === 1 ? '' : 's'}
        </span>
      </div>
      {visibleCards.map((card) =>
        card.hidden ? (
          <HiddenCardPlaceholder key={card.id} columnColor={columnColor} />
        ) : (
          <SortableCardView
            key={card.id}
            card={card}
            canDrag={canDragCard(card)}
            canEdit={canEditCard(card)}
            onEdit={(body) => onEditCard(card.id, body)}
            onDelete={() => onDeleteCard(card.id)}
            menu={menuFor(card)}
            reactionProps={reactionPropsFor(card)}
            highlighted={isHighlighted(card)}
          />
        ),
      )}
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setExpanded(true)} style={{ fontSize: 12 }}>
          +{hiddenCount} more
        </button>
      )}
    </div>
  );
}

type ColumnRow = { kind: 'card'; card: BoardCard } | { kind: 'group'; topic: Topic; cards: BoardCard[] };

/** Lays a column's cards out for rendering (RN-015): ungrouped cards stay individually
 * position-ordered; a group's member cards render together as one row, positioned at its
 * earliest member's position ("a group stays in its column at the position of the card it was
 * dropped on") — topics have no `position` column of their own (see topics.ts), so this is
 * derived rather than stored. A card whose topicId doesn't (yet) resolve to a known topic — which
 * shouldn't happen since every topic-bearing event folds both in together, see boardReducer.ts —
 * is simply skipped rather than rendered as a broken group. */
function buildColumnRows(cards: BoardCard[], topics: Topic[]): ColumnRow[] {
  const grouped = new Map<string, BoardCard[]>();
  const entries: { row: ColumnRow; sortKey: string }[] = [];
  for (const card of cards) {
    if (!card.topicId) {
      entries.push({ row: { kind: 'card', card }, sortKey: card.position });
      continue;
    }
    const existing = grouped.get(card.topicId);
    if (existing) existing.push(card);
    else grouped.set(card.topicId, [card]);
  }
  for (const [topicId, members] of grouped) {
    const topic = topics.find((t) => t.id === topicId);
    if (!topic) continue;
    const sorted = members.slice().sort((a, b) => a.position.localeCompare(b.position));
    entries.push({ row: { kind: 'group', topic, cards: sorted }, sortKey: sorted[0]!.position });
  }
  return entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((e) => e.row);
}

/** The column's own droppable area (RN-014) — lets a card be dropped on empty space below the
 * last card, not only onto another card. Disabled for Action items: "Move onto a card's center is
 * reserved for grouping (RN-015)" is a later story, but "can't drag into Action items" is this
 * one's own AC, so that column is excluded from collision detection entirely (dropping there
 * resolves to no valid target, same as dropping outside any column). */
function DroppableColumn({ column, children }: { column: BoardColumn; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: column.kind === 'action_items' });
  return (
    <section
      ref={setNodeRef}
      style={{
        width: 260,
        flexShrink: 0,
        borderTop: `4px solid ${column.color}`,
        outline: isOver ? '2px solid #3b82f6' : undefined,
        background: '#fafafa',
        borderRadius: 8,
        padding: 8,
      }}
    >
      {children}
    </section>
  );
}

/** The 320px right-edge panel (RN-017 layout spec), facilitator only. Suggestions whose cards got
 * grouped by hand elsewhere (`isStale`) are filtered out by the caller before this ever sees
 * them — rendered rows are always still-actionable. */
function SuggestionRow({
  suggestion,
  columnTitle,
  justAccepted,
  onAccept,
  onReject,
  onHover,
}: {
  suggestion: GroupSuggestion;
  columnTitle: string;
  justAccepted: boolean;
  onAccept: () => void;
  onReject: () => void;
  onHover: (hovering: boolean) => void;
}) {
  if (justAccepted) {
    return (
      <div style={{ border: '1px solid #ccc', borderRadius: 6, padding: 8, marginBottom: 8, color: '#666', fontSize: 13 }}>Grouped</div>
    );
  }
  return (
    <div
      style={{ border: '1px solid #ccc', borderRadius: 6, padding: 8, marginBottom: 8 }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <p style={{ margin: '0 0 2px', fontWeight: 'bold', fontSize: 13 }}>{suggestion.name}</p>
      <p style={{ margin: '0 0 6px', fontSize: 11, color: '#666' }}>{columnTitle}</p>
      {suggestion.cardIds.map((cardId) => (
        <p key={cardId} style={{ margin: '0 0 2px', fontSize: 12, color: '#444' }}>
          • card {cardId.slice(0, 8)}
        </p>
      ))}
      <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
        <button type="button" onClick={onAccept}>
          Accept
        </button>
        <button type="button" onClick={onReject} style={{ border: 'none', background: 'none', color: '#666', cursor: 'pointer' }}>
          Reject
        </button>
      </div>
    </div>
  );
}

function SuggestionsPanel({
  suggestions,
  loading,
  open,
  onToggleOpen,
  justAcceptedIds,
  columnTitleById,
  onHover,
  onAccept,
  onReject,
  onAcceptAll,
}: {
  suggestions: GroupSuggestion[];
  loading: boolean;
  open: boolean;
  onToggleOpen: () => void;
  justAcceptedIds: Set<string>;
  columnTitleById: Map<string, string>;
  onHover: (suggestionId: string | null) => void;
  onAccept: (suggestion: GroupSuggestion) => void;
  onReject: (suggestionId: string) => void;
  onAcceptAll: () => void;
}) {
  return (
    <div style={{ width: 320, flexShrink: 0 }}>
      <button type="button" onClick={onToggleOpen}>
        Suggestions ({suggestions.length})
      </button>
      {open && (
        <div style={{ marginTop: 8, border: '1px solid #ddd', borderRadius: 8, padding: 8 }}>
          {loading && (
            <>
              <p style={{ fontSize: 13, color: '#666', margin: '0 0 8px' }}>Finding similar cards…</p>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ height: 48, background: '#f0f0f0', borderRadius: 6, marginBottom: 8 }} />
              ))}
            </>
          )}
          {!loading && suggestions.length === 0 && (
            <p style={{ fontSize: 13, color: '#666', margin: 0 }}>No suggestions. Group cards by dragging.</p>
          )}
          {!loading && suggestions.length > 0 && (
            <>
              <button type="button" onClick={onAcceptAll} style={{ marginBottom: 8 }}>
                Accept all
              </button>
              {suggestions.map((s) => (
                <SuggestionRow
                  key={s.id}
                  suggestion={s}
                  columnTitle={columnTitleById.get(s.columnId) ?? ''}
                  justAccepted={justAcceptedIds.has(s.id)}
                  onAccept={() => onAccept(s)}
                  onReject={() => onReject(s.id)}
                  onHover={(hovering) => onHover(hovering ? s.id : null)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A single short beep (RN-012: "At zero the pill flashes and chimes once"). Best-effort — a
 * blocked AudioContext (autoplay policy, a headless test run) shouldn't break anything else, so
 * failures are swallowed; the visual flash still carries the alert either way. */
function playChime() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.5);
  } catch {
    // Best-effort, as above.
  }
}

/** The phase countdown pill (RN-012). Ticks once a second purely for display — the deadline
 * itself only ever changes on a transition or extend broadcast, never from a local timer. */
function PhaseTimer({ phaseDeadline, clockOffsetMs }: { phaseDeadline: string | null; clockOffsetMs: number }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = remainingMs(phaseDeadline, clockOffsetMs, nowMs);
  const isExpired = remaining !== null && remaining <= 0;

  const alertedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (isExpired && phaseDeadline && alertedForRef.current !== phaseDeadline) {
      alertedForRef.current = phaseDeadline;
      playChime();
    }
  }, [isExpired, phaseDeadline]);

  if (remaining === null) return null;

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 4,
        fontVariantNumeric: 'tabular-nums',
        background: isExpired ? undefined : '#eee',
        animation: isExpired ? 'rn-timer-flash 1s linear infinite' : undefined,
      }}
    >
      {formatCountdown(remaining)}
    </span>
  );
}

/** Mounts once the initial snapshot is in hand, so the store's `initialBoard`/`initialSeq` are
 * captured exactly once (RN-009: "events after it are applied on top", not re-fetched). */
function Board({
  retroId,
  accessToken,
  userId,
  initialBoard,
}: {
  retroId: string;
  accessToken: string;
  userId: string;
  initialBoard: BoardResponse;
}) {
  // RN-013: declared before the store below so its lazy initializer can close over it — see the
  // effect further down that actually assigns resyncRef.current for the full explanation.
  const resyncRef = useRef<(showBadge: boolean) => void>(() => {});
  // Guards resync() against running twice concurrently — a stale seq gap and a Realtime
  // reconnect can both fire within the same moment, and without this a second resync would
  // start its own retryPendingMutations() while the first's is still in flight, resending the
  // same pending mutationId twice in parallel (found live: two concurrent POSTs with the same
  // mutationId, one of which hit a duplicate-key error server-side — see pipeline.ts's fix).
  const isResyncingRef = useRef(false);

  const [useBoardStore] = useState(() =>
    createRetroStore<BoardState>({
      initialBoard: {
        phase: initialBoard.retro.phase,
        cardsRevealed: initialBoard.retro.cardsRevealed,
        phaseDeadline: initialBoard.retro.phaseDeadline,
        columns: initialBoard.columns,
        cards: initialBoard.cards,
        topics: initialBoard.topics,
        voteBudget: initialBoard.retro.voteBudget,
        myVotes: Object.fromEntries(initialBoard.myVotes.map((v) => [v.topicId, v.count])),
        votingProgress: initialBoard.votingProgress,
      },
      initialSeq: initialBoard.seq,
      reduce: reduceBoard,
    }),
  );
  const {
    board,
    lastError,
    hasStaleGap,
    applyServerEvent,
    applyLocalPatch,
    resetBoard,
    retryPendingMutations,
    sendMutation,
    clearError,
  } = useBoardStore();
  const isFacilitator = userId === initialBoard.retro.facilitatorId;
  // RN-012: computed once, from the snapshot that's already in hand — every later countdown
  // (this phase or the next) is estimated against this same offset, not recomputed each time.
  const [clockOffsetMs] = useState(() => computeClockOffsetMs(initialBoard.serverTime));
  // RN-013: "Reconnecting…" badge — true from the moment the Realtime channel drops until a
  // resync (refetch + replay of anything still pending) finishes.
  const [isReconnecting, setIsReconnecting] = useState(false);
  // The Action items column follows the matrix's separate "Create or edit action items" row
  // (Review/Discuss/Wrap up), not "Add, edit, delete own card" (Write/Group) — matching the
  // server-side check in cardCreate/cardEdit/cardDelete's apply().
  function canEditColumn(columnKind: 'standard' | 'action_items'): boolean {
    const actions = allowedActions(board.phase);
    return columnKind === 'action_items' ? actions.actionItemEdit : actions.cardCrud;
  }

  // RN-014: drag scope comes from the same phase matrix as everything else (Write = own cards
  // only, Group = all cards, everything else = none — see stateMachine.ts's cardDrag). Action
  // items aren't part of this story's drag surface at all (only "can't drag *into*" is a
  // documented AC) — kept conservative rather than untested, so a card already sitting in that
  // column is never draggable either.
  function canDragCard(card: BoardCard, columnKind: 'standard' | 'action_items'): boolean {
    if (columnKind === 'action_items') return false;
    const scope = allowedActions(board.phase).cardDrag;
    if (scope === 'none') return false;
    if (scope === 'all') return true;
    return card.authorId === userId;
  }

  // RN-015: "Group cards, accept AI groups" — Group phase only, no ownership check (unlike
  // cardCrud/cardDrag's "own cards" scopes). Gates both the center-drop grouping path and the
  // "Group with…" menu's visibility, and whether a group's name is clickable to rename.
  const canGroup = allowedActions(board.phase).cardGroup;

  // RN-016: "Allowed on any revealed card... Not allowed during Vote" — no ownership check
  // ("anyone can react to anyone's card") and no column-kind branching (Action items cards react
  // the same as any other). 'after_reveal' (Write) additionally needs cardsRevealed; a hidden
  // card never reaches this function at all (only visible cards render a ReactionBar).
  function canReactToCard(): boolean {
    const scope = allowedActions(board.phase).cardReact;
    if (scope === 'never') return false;
    if (scope === 'after_reveal') return board.cardsRevealed;
    return true;
  }

  // RN-018: "Vote" row of the matrix — Vote phase only, no ownership check (everyone spends their
  // own budget on anyone's topic).
  const canVote = allowedActions(board.phase).vote;
  // "N votes remaining", computed client-side from the viewer's own dot counts — never guessed
  // from votingProgress, which only ever carries aggregate done/total, never per-topic detail.
  const votesRemaining = board.voteBudget - Object.values(board.myVotes).reduce((sum, n) => sum + n, 0);
  // "After Vote, topics display vote counts" — vote_count is structurally 0 everywhere until the
  // vote->discuss transition actually reveals it (topics.ts), so gating on phase here (rather than
  // just checking voteCount > 0) is what keeps a topic that genuinely got zero votes from looking
  // indistinguishable from "not revealed yet" during Vote itself.
  const votesRevealed = board.phase !== 'review' && board.phase !== 'write' && board.phase !== 'group' && board.phase !== 'vote';

  // RN-017: AI grouping suggestions — facilitator-only panel state. `suggestions` starts from
  // the initial snapshot (a reload mid-Group picks up whatever was already pending) and is
  // otherwise only ever added to by the worker's one-shot `group.suggestions` broadcast (see the
  // user:{id} channel listener below) — never re-fetched.
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>(initialBoard.suggestions ?? []);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsPanelOpen, setSuggestionsPanelOpen] = useState(false);
  const [hoveredSuggestionId, setHoveredSuggestionId] = useState<string | null>(null);
  // "accepted (collapses to 'Grouped' for 2s, then disappears)" — tracked separately from
  // actually removing the suggestion so the collapsed state has something to render first.
  const [justAcceptedIds, setJustAcceptedIds] = useState<Set<string>>(new Set());

  // "stale (a suggestion whose cards were already grouped by hand disappears)" — derived at
  // render time rather than pruned from state, since the underlying cause (some other card.move/
  // topic.createFromCards/card.addToTopic broadcast) can arrive from anywhere, not just this
  // panel's own actions.
  const visibleSuggestions = suggestions.filter(
    (s) => !justAcceptedIds.has(s.id) && !s.cardIds.some((id) => board.cards.find((c) => c.id === id)?.topicId),
  );
  const columnTitleById = new Map(board.columns.map((c) => [c.id, c.title]));
  const highlightedCardIds = new Set(hoveredSuggestionId ? (suggestions.find((s) => s.id === hoveredSuggestionId)?.cardIds ?? []) : []);

  function acceptSuggestion(suggestion: GroupSuggestion) {
    const mutationId = uuidv7();
    setJustAcceptedIds((prev) => new Set(prev).add(suggestion.id));
    setTimeout(() => {
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setJustAcceptedIds((prev) => {
        const next = new Set(prev);
        next.delete(suggestion.id);
        return next;
      });
    }, 2000);
    void sendMutation({
      mutationId,
      // No optimistic shortcut — the real suggestion.accept broadcast (shaped exactly like
      // topic.createFromCards) is what actually carries the new topic and its cards.
      optimisticReduce: (b) => b,
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'suggestion.accept', payload: { suggestionId: suggestion.id } }),
    });
  }

  function rejectSuggestion(suggestionId: string) {
    const mutationId = uuidv7();
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => b,
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'suggestion.reject', payload: { suggestionId } }),
    });
  }

  function acceptAllSuggestions() {
    for (const s of visibleSuggestions) acceptSuggestion(s);
  }

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeCard = board.cards.find((c) => c.id === activeId && !c.hidden) as VisibleBoardCard | undefined;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function moveCard(cardId: string, columnId: string, position: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      // A local-only patch, same reasoning as editCard's: all a drop gives us is the new
      // columnId/position, not a full server-shaped card. Always clears topicId (RN-015: a move
      // always places the card by position, which always leaves whatever group it was in).
      optimisticReduce: (b) => ({
        ...b,
        cards: b.cards.map((c) => (c.id === cardId ? { ...c, columnId, position, topicId: null } : c)),
      }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'card.move', payload: { cardId, columnId, position } }),
    });
  }

  // RN-015: "Dropping card A on card B's center creates a named group containing both" — the
  // default name (first card's text, truncated) is computed the same way the server would if the
  // payload omitted `name` (defaultTopicName, shared so the two never briefly disagree).
  function createTopicFromCards(cardIdA: string, cardIdB: string) {
    const topicId = uuidv7();
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => {
        const first = b.cards.find((c) => c.id === cardIdA) ?? b.cards.find((c) => c.id === cardIdB);
        if (!first) return b;
        const topic: Topic = {
          id: topicId,
          columnId: first.columnId,
          name: !first.hidden ? defaultTopicName(first.body) : 'New group',
          voteCount: 0,
        };
        return {
          ...b,
          topics: [...b.topics, topic],
          cards: b.cards.map((c) => (c.id === cardIdA || c.id === cardIdB ? { ...c, topicId } : c)),
        };
      },
      send: () =>
        postMutation(accessToken, retroId, { mutationId, type: 'topic.createFromCards', payload: { topicId, cardIds: [cardIdA, cardIdB] } }),
    });
  }

  // RN-015: dropping onto a card that's already grouped, or picking one from the "Group with…"
  // menu. The server's own result also carries a possible dissolvedTopic for the card's *previous*
  // group (see boardReducer.ts) — nothing to predict optimistically for that half, same as
  // revealCards's broadcast-only approach.
  function addToTopic(cardId: string, topicId: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => ({ ...b, cards: b.cards.map((c) => (c.id === cardId ? { ...c, topicId } : c)) }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'card.addToTopic', payload: { cardId, topicId } }),
    });
  }

  function renameTopic(topicId: string, name: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => ({ ...b, topics: b.topics.map((t) => (t.id === topicId ? { ...t, name } : t)) }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'topic.rename', payload: { topicId, name } }),
    });
  }

  // The single decision point both the center-drop path and the "Group with…" menu route
  // through: joining a card that's already grouped adds to its group, otherwise a brand-new one
  // is created from just the two cards involved.
  function groupCardWith(draggedCard: BoardCard, targetCard: BoardCard) {
    if (draggedCard.topicId && draggedCard.topicId === targetCard.topicId) return; // already grouped together
    if (targetCard.topicId) addToTopic(draggedCard.id, targetCard.topicId);
    else createTopicFromCards(draggedCard.id, targetCard.id);
  }

  // RN-016: one call flips membership either way — `added` isn't known locally until the server
  // confirms it, so this guesses the direction from whatever the viewer's own current state is
  // (toggleReaction, boardReducer.ts, is the exact same fold the confirmed broadcast uses).
  function toggleCardReaction(cardId: string, emoji: Emoji) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => ({
        ...b,
        cards: b.cards.map((c) => {
          if (c.id !== cardId || c.hidden) return c;
          const mine = c.reactions.some((r) => r.emoji === emoji && r.userIds.includes(userId));
          return { ...c, reactions: toggleReaction(c.reactions, { cardId, userId, emoji, added: !mine }) };
        }),
      }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'reaction.toggle', payload: { cardId, emoji } }),
    });
  }

  // RN-018: optimistically bumps only this viewer's own dot count — `votingProgress` (how many
  // *other* people are done) depends on everyone else's state, which there's no reliable way to
  // guess locally, so it's deliberately left untouched here and only ever updated from a
  // confirmed broadcast (same precedent as elsewhere in this file: no optimistic shortcut for
  // anything that depends on other participants).
  function addVote(topicId: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => ({ ...b, myVotes: { ...b.myVotes, [topicId]: (b.myVotes[topicId] ?? 0) + 1 } }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'vote.add', payload: { topicId } }),
    });
  }

  function removeVote(topicId: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => {
        const current = b.myVotes[topicId] ?? 0;
        if (current <= 0) return b;
        const myVotes = { ...b.myVotes };
        if (current <= 1) delete myVotes[topicId];
        else myVotes[topicId] = current - 1;
        return { ...b, myVotes };
      },
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'vote.remove', payload: { topicId } }),
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  // Bug (#20): `verticalListSortingStrategy` (dnd-kit's default) shifts every *other* card's
  // transform live, mid-drag, to preview where they'd land if the drag ended now — that's what
  // made dropping on a card look like "reranking" instead of grouping: the hovered card kept
  // sliding out from under the pointer, so by drop time its rect had already moved and rarely
  // still overlapped the dragged card's center. We never read dnd-kit's own reorder output
  // anyway (handleDragEnd below always recomputes the target from `board.cards` + siblings), so
  // that live preview was purely cosmetic — and actively wrong for this board's two gestures
  // ("drop on center groups, drop between moves"). Returning `null` for every card keeps every
  // non-dragged card's rect exactly where it rests, which is what isCenterDrop's math assumes.
  function noSortPreview(): null {
    return null;
  }

  // RN-015 layout spec: "hovering over a card's center gives it a 2px blue outline" — the
  // collision zone is the middle 50% of the target's rect, checked against the dragged card's own
  // center (not the pointer) so this matches regardless of where on the dragged card the pointer
  // grabbed it.
  function isCenterDrop(event: DragEndEvent): boolean {
    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect;
    if (!activeRect || !overRect) return false;
    const activeCenterY = activeRect.top + activeRect.height / 2;
    const zoneTop = overRect.top + overRect.height * 0.25;
    const zoneBottom = overRect.top + overRect.height * 0.75;
    return activeCenterY >= zoneTop && activeCenterY <= zoneBottom;
  }

  // One mutation per drop (the story's own framing) — figures out the target column (a card's
  // own columnId if dropped on a card, otherwise the column droppable's id directly for an empty-
  // space drop), then computes a fractional position between whatever ends up as this card's new
  // neighbors. No onDragOver handling: the drop's final state is correct either way, live cross-
  // column reflow mid-drag is the known gap (consistent with this session's other mock-fidelity
  // gaps, e.g. RN-009/010/012).
  //
  // RN-015: "dropping onto a card's center (collision zone ≈ middle 50%) groups; dropping between
  // cards moves" — checked first, before any of the move-specific position math below, since a
  // grouping drop doesn't touch position at all.
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || over.id === active.id) return;

    const cardId = active.id as string;
    const draggedCard = board.cards.find((c) => c.id === cardId);
    if (!draggedCard) return;

    const overCard = board.cards.find((c) => c.id === over.id);

    if (overCard && overCard.columnId === draggedCard.columnId && canGroup && isCenterDrop(event)) {
      groupCardWith(draggedCard, overCard);
      return;
    }

    const targetColumnId = overCard ? overCard.columnId : (over.id as string);
    const targetColumn = board.columns.find((c) => c.id === targetColumnId);
    if (!targetColumn || targetColumn.kind === 'action_items') return;

    const siblings = board.cards
      .filter((c) => c.columnId === targetColumnId && c.id !== cardId)
      .sort((a, b) => a.position.localeCompare(b.position));
    const insertIndex = overCard ? Math.max(siblings.findIndex((c) => c.id === overCard.id), 0) : siblings.length;
    const prevCard = insertIndex > 0 ? siblings[insertIndex - 1] : undefined;
    const nextCard = insertIndex < siblings.length ? siblings[insertIndex] : undefined;
    const position = generateKeyBetween(prevCard?.position ?? null, nextCard?.position ?? null);

    if (targetColumnId === draggedCard.columnId && position === draggedCard.position) return;
    moveCard(cardId, targetColumnId, position);
  }

  // RN-013: one resync path for every trigger — a stale seq gap, a Realtime reconnect, or
  // RN-011's write->group card reveal (its own broadcast never carries card bodies — see
  // onTransition.ts). Refetches the snapshot, replaces the store (re-applying anything still
  // pending on top, so an offline edit doesn't flicker away), then resends whatever's still
  // pending with its original mutationId.
  //
  // `showBadge` matters: the "Reconnecting…" badge means "the connection was actually lost,"
  // not "a resync happened for any reason" — RN-011's write->group resync runs on every single
  // phase advance, including ones with no connection trouble at all, and flashing "Reconnecting"
  // for that was a real bug (found live: clicking Skip showed it every time). Only the two
  // genuinely connection-related triggers (the Realtime reconnect handler and the hasStaleGap
  // effect, both below) pass `true`.
  //
  // Held in a ref because two other effects below need to call "the current resync logic" from
  // inside their own callbacks (the Realtime subscribe status handler, and the hasStaleGap
  // effect) without re-subscribing or re-running just because accessToken rotated — this effect
  // is what keeps resyncRef.current pointed at a closure built from the latest accessToken/
  // retroId (accessToken can rotate over a long session; a stale closure would keep resyncing
  // with an expired token).
  useEffect(() => {
    resyncRef.current = (showBadge) => {
      if (isResyncingRef.current) return;
      isResyncingRef.current = true;
      if (showBadge) setIsReconnecting(true);
      void fetchBoard(accessToken, retroId)
        .then((fresh) => {
          resetBoard(
            {
              phase: fresh.retro.phase,
              cardsRevealed: fresh.retro.cardsRevealed,
              phaseDeadline: fresh.retro.phaseDeadline,
              columns: fresh.columns,
              cards: fresh.cards,
              topics: fresh.topics,
              voteBudget: fresh.retro.voteBudget,
              myVotes: Object.fromEntries(fresh.myVotes.map((v) => [v.topicId, v.count])),
              votingProgress: fresh.votingProgress,
            },
            fresh.seq,
          );
          return retryPendingMutations();
        })
        .finally(() => {
          isResyncingRef.current = false;
          if (showBadge) setIsReconnecting(false);
        });
    };
  }, [accessToken, retroId, resetBoard, retryPendingMutations]);

  // RN-013: "a seq gap older than 1s" — retroStore.ts's own hasStaleGap flag, reacted to here
  // rather than the store calling back into BoardPage directly (keeps the store from invoking
  // arbitrary caller code, and keeps this a plain effect reading resyncRef — always safe, unlike
  // reading it from a closure built during render). This is a genuine connection-trouble signal
  // (the story's own framing), so the badge shows for it.
  useEffect(() => {
    if (hasStaleGap) resyncRef.current(true);
  }, [hasStaleGap]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let hasSubscribedOnce = false;
    // StrictMode (main.tsx) runs this effect's mount -> cleanup -> mount again in dev, and the
    // first pair's channel teardown can still deliver a late CLOSED/CHANNEL_ERROR status to its
    // (now-torn-down) subscribe callback after the second mount has already settled things —
    // without this guard that stale callback would flip isReconnecting back on for a connection
    // that was never actually lost. Set in this closure's own cleanup below.
    let cancelled = false;

    const retroChannel = client.channel(`retro:${retroId}`, { config: { private: true } });
    retroChannel.on('broadcast', { event: '*' }, (message) => {
      const { seq, result } = message.payload as { seq: number; result: unknown };
      applyServerEvent({ seq, type: message.event, payload: result });
    });
    retroChannel.subscribe((status) => {
      if (cancelled) return;
      if (status === 'SUBSCRIBED') {
        // The first SUBSCRIBED is the initial connect — the board is already fresh from GET
        // /board moments ago, nothing to resync. Every one after that is a reconnect: the badge
        // (already showing, from the CHANNEL_ERROR/CLOSED/TIMED_OUT branch below) stays up
        // through this resync and is cleared in its own finally, not here — clearing it early
        // would flicker it off and immediately back on for the resync's duration.
        const isReconnect = hasSubscribedOnce;
        hasSubscribedOnce = true;
        if (isReconnect) resyncRef.current(true);
      } else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setIsReconnecting(true);
      }
    });

    // RN-011: the author's own private channel — carries the full (never redacted) card for
    // card.create/card.edit while it's hidden on the shared retro:{retroId} channel above, so a
    // second open tab (which has no optimistic copy of its own) still sees real text. Patched in
    // directly rather than run through the seq-gated applyServerEvent: this message shares the
    // same seq as the one the shared channel already applied, and the seq gate would just drop
    // it as a stale replay (see retroStore.ts's applyLocalPatch comment).
    const userChannel = client.channel(`user:${userId}`, { config: { private: true } });
    userChannel.on('broadcast', { event: '*' }, (message) => {
      // RN-017: the worker's one-shot ai.groupCards result — not a retro_events mutation at all
      // (no seq, nothing for reduceBoard to fold), so it's handled entirely separately from the
      // card-echo path below.
      if (message.event === 'group.suggestions') {
        const { suggestions: incoming } = message.payload as { suggestions: GroupSuggestion[] };
        setSuggestions((prev) => [...prev, ...incoming]);
        setSuggestionsLoading(false);
        return;
      }
      const { result } = message.payload as { seq: number; result: unknown };
      applyLocalPatch((b) => reduceBoard(b, { seq: -1, type: message.event, payload: result }));
    });
    userChannel.subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(retroChannel);
      void client.removeChannel(userChannel);
    };
  }, [retroId, userId, applyServerEvent, applyLocalPatch]);

  // RN-011: "Reveal happens ... on write -> group", but the transition's own broadcast only
  // carries the new phase, not every card's real text (see onTransition.ts's write->group
  // comment for why) — so once Write ends, resync once to pick up what was hidden a moment ago.
  // Not a connection problem (no badge) — this runs on every single phase advance out of Write.
  const previousPhaseRef = useRef(board.phase);
  useEffect(() => {
    if (previousPhaseRef.current === 'write' && board.phase !== 'write') resyncRef.current(false);
    // RN-018: "every card belongs to exactly one topic" once Vote starts — group->vote
    // (onTransition.ts) auto-creates a single-card topic for anything still ungrouped, but that
    // transition's own broadcast only carries the new phase (PhaseTransitionResult), same gap as
    // write->group's reveal above. Without this, any card nobody manually grouped during Group
    // never gets a topic in this client's board state, so it renders as a bare, vote-control-less
    // card forever — resync once to pick up whatever topics actually exist now.
    if (previousPhaseRef.current === 'group' && board.phase === 'vote') resyncRef.current(false);
    // RN-017: "Within 5s of entering Group, the facilitator sees suggested groups" — a live
    // transition (not a reload that happens to land already in Group — see this state's own
    // declaration comment) starts the "Finding similar cards…" window. The fallback timeout
    // below is what ends it if ai.groupCards never responds at all (no API key, or the call
    // failing) — "failure shows nothing," the same empty message as zero suggestions.
    if (previousPhaseRef.current === 'write' && board.phase === 'group' && isFacilitator) {
      setSuggestionsLoading(true);
    }
    previousPhaseRef.current = board.phase;
  }, [board.phase, isFacilitator]);

  useEffect(() => {
    if (!suggestionsLoading) return;
    const timeout = setTimeout(() => setSuggestionsLoading(false), 6000);
    return () => clearTimeout(timeout);
  }, [suggestionsLoading]);

  function addCard(columnId: string, body: string) {
    const cardId = uuidv7();
    const mutationId = uuidv7();
    const now = new Date().toISOString();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) =>
        reduceBoard(b, {
          seq: -1,
          type: 'card.create',
          payload: {
            id: cardId,
            columnId,
            authorId: userId,
            authorName: 'You',
            body,
            position: '',
            createdAt: now,
            updatedAt: now,
            topicId: null,
            reactions: [],
            hidden: false,
          },
        }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'card.create', payload: { cardId, columnId, body } }),
    });
  }

  function editCard(cardId: string, body: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      // A local-only patch, not reduceBoard's card.edit branch: that branch expects the server's
      // full authoritative card (RN-011), and all a caller-initiated edit has is the new body.
      optimisticReduce: (b) => ({
        ...b,
        cards: b.cards.map((c) => (c.id === cardId && !c.hidden ? { ...c, body } : c)),
      }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'card.edit', payload: { cardId, body } }),
    });
  }

  function deleteCard(cardId: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => reduceBoard(b, { seq: -1, type: 'card.delete', payload: { id: cardId } }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'card.delete', payload: { cardId } }),
    });
  }

  function revealCards() {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      // No optimistic shortcut — the real cards.reveal broadcast (arriving shortly after) is
      // what actually carries every hidden card's text; there's nothing useful to guess here.
      optimisticReduce: (b) => b,
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'cards.reveal', payload: {} }),
    });
  }

  function changePhase(direction: 'skip' | 'back') {
    const type = direction === 'skip' ? 'phase.skip' : 'phase.back';
    const target = direction === 'skip' ? nextPhase(board.phase) : previousPhase(board.phase);
    if (!target) return;
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      // The deadline here is an estimate — the real, server-computed one (from setPhase) arrives
      // moments later via the broadcast and replaces it; a countdown briefly off by network
      // latency beats one that visibly jumps from "no timer" to a number a beat later.
      optimisticReduce: (b) => {
        const targetMinutes = phaseDurationMinutes(target);
        const estimatedDeadline = targetMinutes === null ? null : new Date(Date.now() + targetMinutes * 60_000).toISOString();
        return reduceBoard(b, { seq: -1, type, payload: { phase: target, phaseDeadline: estimatedDeadline } });
      },
      send: () => postMutation(accessToken, retroId, { mutationId, type, payload: {} }),
    });
  }

  function extendPhase(minutes: 1 | 2 | 5) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => {
        if (!b.phaseDeadline) return b;
        const base = Math.max(Date.now(), Date.parse(b.phaseDeadline));
        return reduceBoard(b, { seq: -1, type: 'phase.extend', payload: { phaseDeadline: new Date(base + minutes * 60_000).toISOString() } });
      },
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'phase.extend', payload: { minutes } }),
    });
  }

  // Header pill bar per mock (RN-010): current phase is the dark pill; past phases stay
  // clickable-looking but inert — there's no "jump to phase" action, only next/back/skip.
  const PHASE_PILLS: RetroPhase[] = ['review', 'write', 'group', 'vote', 'discuss', 'wrap_up'];
  const currentPillIndex = PHASE_PILLS.indexOf(board.phase);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <style>{'@keyframes rn-timer-flash { 0%, 100% { background: #c00; color: #fff; } 50% { background: #fff; color: #c00; } }'}</style>
      <h1 style={{ marginBottom: 4 }}>{initialBoard.retro.name}</h1>
      {isReconnecting && (
        <p role="status" style={{ margin: '0 0 4px', color: '#a66a00', fontSize: 13 }}>
          Reconnecting…
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        {PHASE_PILLS.map((phase, index) => (
          <span
            key={phase}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              background: phase === board.phase ? '#222' : '#eee',
              color: phase === board.phase ? '#fff' : index < currentPillIndex ? '#aaa' : '#888',
            }}
          >
            {phase.replace('_', ' ')}
          </span>
        ))}
        <PhaseTimer phaseDeadline={board.phaseDeadline} clockOffsetMs={clockOffsetMs} />
      </div>
      <p style={{ margin: '0 0 8px', color: '#666' }}>{phaseSubtitle(board.phase)}</p>
      {board.phase === 'vote' && (
        <p style={{ margin: '0 0 8px', fontSize: 13 }}>
          {votesRemaining} vote{votesRemaining === 1 ? '' : 's'} remaining
          {board.votingProgress && ` · ${board.votingProgress.done} of ${board.votingProgress.total} done voting`}
        </p>
      )}
      {isFacilitator && (
        <p style={{ margin: '0 0 16px' }}>
          {previousPhase(board.phase) && (
            <button type="button" onClick={() => changePhase('back')}>
              Back
            </button>
          )}{' '}
          {nextPhase(board.phase) && (
            <button type="button" onClick={() => changePhase('skip')}>
              Skip
            </button>
          )}{' '}
          {board.phaseDeadline &&
            [1, 2, 5].map((minutes) => (
              <button key={minutes} type="button" onClick={() => extendPhase(minutes as 1 | 2 | 5)}>
                +{minutes}
              </button>
            ))}{' '}
          {board.phase === 'write' && !board.cardsRevealed && (
            <button type="button" onClick={revealCards}>
              Reveal cards
            </button>
          )}
        </p>
      )}
      {lastError && (
        <p role="alert" style={{ color: 'crimson' }}>
          {lastError}{' '}
          <button type="button" onClick={clearError}>
            Dismiss
          </button>
        </p>
      )}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
            {board.columns
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((column) => {
                const cards = board.cards
                  .filter((c) => c.columnId === column.id)
                  .sort((a, b) => a.position.localeCompare(b.position));
                const canEdit = canEditColumn(column.kind);
                const rows = buildColumnRows(cards, board.topics);
                // RN-018 AC: "After Vote, topics display vote counts and sort descending, ties by
                // creation time." `Array.prototype.sort` is stable, so ties keep `rows`' own
                // position-derived order — a reasonable stand-in for creation time, since cards
                // are added in roughly that order and nothing before this story needed anything
                // truer than that. A bare (ungrouped) card can't appear once vote counts are
                // revealed — group->vote (onTransition.ts) gives every card a topic before Vote
                // ever starts — but sorts as 0 rather than crashing if one somehow did.
                const displayRows = votesRevealed
                  ? [...rows].sort((a, b) => (b.kind === 'group' ? b.topic.voteCount : 0) - (a.kind === 'group' ? a.topic.voteCount : 0))
                  : rows;
                // Kept in sync with rendered (grouped) order, not raw position order, so
                // dnd-kit's own notion of item order matches the DOM it's actually measuring.
                const sortableIds = displayRows.flatMap((row) =>
                  row.kind === 'card' ? (row.card.hidden ? [] : [row.card.id]) : row.cards.filter((c) => !c.hidden).map((c) => c.id),
                );
                function menuForCard(card: VisibleBoardCard): ReactNode {
                  if (!canGroup) return undefined;
                  return (
                    <CardMenu
                      card={card}
                      otherCards={cards.filter((c): c is VisibleBoardCard => !c.hidden && c.id !== card.id)}
                      onGroupWith={(targetId) => {
                        const target = cards.find((c) => c.id === targetId);
                        if (target) groupCardWith(card, target);
                      }}
                    />
                  );
                }
                function reactionPropsFor(card: VisibleBoardCard): ReactionBarProps {
                  return {
                    reactions: card.reactions,
                    viewerId: userId,
                    canReact: canReactToCard(),
                    onToggleReaction: (emoji) => toggleCardReaction(card.id, emoji),
                  };
                }
                return (
                  <DroppableColumn key={column.id} column={column}>
                    <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>
                      {column.title} <span style={{ fontWeight: 'normal', color: '#666' }}>({cards.length})</span>
                    </h2>
                    {column.prompt && <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>{column.prompt}</p>}
                    <SortableContext items={sortableIds} strategy={noSortPreview}>
                      {displayRows.map((row) =>
                        row.kind === 'card' ? (
                          row.card.hidden ? (
                            <HiddenCardPlaceholder key={row.card.id} columnColor={column.color} />
                          ) : (
                            <SortableCardView
                              key={row.card.id}
                              card={row.card}
                              canDrag={canDragCard(row.card, column.kind)}
                              canEdit={canEdit && row.card.authorId === userId}
                              onEdit={(body) => editCard(row.card.id, body)}
                              onDelete={() => deleteCard(row.card.id)}
                              menu={menuForCard(row.card)}
                              reactionProps={reactionPropsFor(row.card)}
                              highlighted={highlightedCardIds.has(row.card.id)}
                            />
                          )
                        ) : (
                          <TopicGroupView
                            key={row.topic.id}
                            topic={row.topic}
                            cards={row.cards}
                            columnColor={column.color}
                            canRename={canGroup}
                            canDragCard={(c) => canDragCard(c, column.kind)}
                            canEditCard={(c) => canEdit && c.authorId === userId}
                            onRename={(name) => renameTopic(row.topic.id, name)}
                            onEditCard={(id, body) => editCard(id, body)}
                            onDeleteCard={(id) => deleteCard(id)}
                            menuFor={menuForCard}
                            reactionPropsFor={reactionPropsFor}
                            isHighlighted={(c) => highlightedCardIds.has(c.id)}
                            voteControls={
                              canVote ? (
                                <VoteControls
                                  topicName={row.topic.name}
                                  myCount={board.myVotes[row.topic.id] ?? 0}
                                  remaining={votesRemaining}
                                  onAdd={() => addVote(row.topic.id)}
                                  onRemove={() => removeVote(row.topic.id)}
                                />
                              ) : undefined
                            }
                            voteCountBadge={
                              votesRevealed ? (
                                <span style={{ fontSize: 12, color: '#666' }}>
                                  {row.topic.voteCount} vote{row.topic.voteCount === 1 ? '' : 's'}
                                </span>
                              ) : undefined
                            }
                          />
                        ),
                      )}
                    </SortableContext>
                    {canEdit && <AddCardForm onAdd={(body) => addCard(column.id, body)} />}
                  </DroppableColumn>
                );
              })}
          </div>
          <DragOverlay>
            {activeCard && (
              <div style={{ transform: 'rotate(2deg)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                <CardView
                  card={activeCard}
                  canEdit={false}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  reactionProps={{ reactions: activeCard.reactions, viewerId: userId, canReact: false, onToggleReaction: () => {} }}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
        {isFacilitator && board.phase === 'group' && (
          <SuggestionsPanel
            suggestions={visibleSuggestions}
            loading={suggestionsLoading}
            open={suggestionsPanelOpen}
            onToggleOpen={() => setSuggestionsPanelOpen((v) => !v)}
            justAcceptedIds={justAcceptedIds}
            columnTitleById={columnTitleById}
            onHover={setHoveredSuggestionId}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            onAcceptAll={acceptAllSuggestions}
          />
        )}
      </div>
      {footerHint(board.phase) && <p style={{ marginTop: 24, color: '#666', fontSize: 13 }}>{footerHint(board.phase)}</p>}
    </main>
  );
}

export function BoardPage({ retroId }: { retroId: string }) {
  const session = useSession();
  const accessToken = session?.access_token;
  const board = useQuery({
    queryKey: ['board', retroId, accessToken],
    queryFn: () => fetchBoard(accessToken as string, retroId),
    enabled: !!accessToken,
  });

  if (!supabase) return <p>Supabase is not configured.</p>;

  if (!accessToken) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        <p>Sign in to view this board.</p>
        <button type="button" onClick={() => void signInWithGoogle()}>
          Continue with Google
        </button>
      </main>
    );
  }

  if (board.isPending) return <p>Loading board…</p>;
  if (board.isError) return <p>Failed to load board.</p>;

  return <Board retroId={retroId} accessToken={accessToken} userId={session.user.id} initialBoard={board.data} />;
}
