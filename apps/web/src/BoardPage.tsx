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
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
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
  type ActionItem,
  type ActionItemReviewOutcome,
  type BoardCard,
  type BoardColumn,
  type BoardResponse,
  type Emoji,
  type GroupSuggestion,
  type ReactionSummary,
  type RetroPhase,
  type Topic,
  type TopicSummary,
  type TopicSummaryPoint,
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

// RN-023: "'Next retro' date picker prefilled from the cadence" — next_retro_at is usually unset
// (nothing schedules it until a retro actually closes), so the fallback is what's actually
// exercised today. Shared with RN-022's own due-date default below, since "next retro" is the
// same date either way, not two independent computations.
function defaultNextRetroDate(retro: BoardResponse['retro']): string {
  if (retro.nextRetroAt) return retro.nextRetroAt;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + retro.retroCadenceDays);
  return d.toISOString().slice(0, 10);
}

// RN-022: "due date defaults to the day before the next retro."
function defaultActionItemDueDate(retro: BoardResponse['retro']): string {
  const d = new Date(`${defaultNextRetroDate(retro)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Mock: "Name · due Oct 6" — no time-of-day concept for a due date (actionItems.ts), so this never
// needs to account for the viewer's own timezone the way a real timestamp would.
function formatDueDate(dueDate: string): string {
  return new Date(`${dueDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** RN-022: manual creation from the Action items column — "+ Add a card" per the story's own
 * technical notes, just with an owner and due date alongside the title. */
function AddActionItemForm({
  teamMembers,
  defaultDueDate,
  onAdd,
}: {
  teamMembers: { id: string; displayName: string }[];
  defaultDueDate: string;
  onAdd: (title: string, ownerId: string | null, dueDate: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dueDate, setDueDate] = useState(defaultDueDate);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed, ownerId || null, dueDate || null);
    setTitle('');
    setOwnerId('');
    setDueDate(defaultDueDate);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="+ Add an action item"
        aria-label="Add an action item"
        rows={2}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <select aria-label="Owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} style={{ flex: 1 }}>
          <option value="">Unassigned</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        <input aria-label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <button type="button" onClick={submit}>
          Add
        </button>
      </div>
    </div>
  );
}

/** RN-022: "title, owner avatar, 'Name · due Oct 6', reactions" per the mock — reactions are
 * skipped (no backing table: action_items has no equivalent of card_reactions, and the AC list
 * never asks for them). No avatar image infra exists yet either (same gap HiddenCardPlaceholder's
 * own comment already notes), so this shows the owner's name instead. */
// RN-025: labels for the Review quick actions — 'carried' is "Keep open" as a button, the same
// outcome value the review->write sweep stamps on anything left unmarked (onTransition.ts).
const REVIEW_OUTCOME_LABEL: Record<ActionItemReviewOutcome, string> = {
  done: 'Done',
  in_progress: 'In progress',
  dropped: 'Drop',
  carried: 'Keep open',
};
const REVIEW_OUTCOMES: ActionItemReviewOutcome[] = ['done', 'in_progress', 'dropped', 'carried'];

function ActionItemRow({
  item,
  teamMembers,
  canEdit,
  onUpdate,
  isCarriedOver,
  reviewOutcome,
  onReview,
}: {
  item: ActionItem;
  teamMembers: { id: string; displayName: string }[];
  canEdit: boolean;
  onUpdate: (patch: { ownerId?: string | null; dueDate?: string | null }) => void;
  // RN-025: "Review" quick actions only ever apply to an item carried in from a *past* retro —
  // never this retro's own, freshly created one (see actionItemReview.ts's own "not_reviewable").
  isCarriedOver: boolean;
  reviewOutcome: ActionItemReviewOutcome | null;
  onReview: (outcome: ActionItemReviewOutcome) => void;
}) {
  const ownerName = teamMembers.find((m) => m.id === item.ownerId)?.displayName ?? 'Unassigned';
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <p style={{ margin: '0 0 6px', fontSize: 13 }}>{item.title}</p>
      {canEdit ? (
        <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
          <select
            aria-label={`Owner for ${item.title}`}
            value={item.ownerId ?? ''}
            onChange={(e) => onUpdate({ ownerId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          <input
            aria-label={`Due date for ${item.title}`}
            type="date"
            value={item.dueDate ?? ''}
            onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
          />
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
          {ownerName}
          {item.dueDate && ` · due ${formatDueDate(item.dueDate)}`}
        </p>
      )}
      {isCarriedOver && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {REVIEW_OUTCOMES.map((outcome) => (
            <button
              key={outcome}
              type="button"
              onClick={() => onReview(outcome)}
              style={{
                fontSize: 11,
                fontWeight: reviewOutcome === outcome ? 'bold' : 'normal',
                textDecoration: reviewOutcome === outcome ? 'underline' : undefined,
              }}
            >
              {REVIEW_OUTCOME_LABEL[outcome]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** RN-023 layout spec (no mock — "build from existing board components"): a centered 520px
 * modal, facilitator only, opened from the header during Wrap up. "Close retro" stays disabled
 * while any *active* item lacks an owner — computed from `actionItems` directly (already in
 * `board.actionItems`, no separate fetch) rather than waiting on the server's own F2 check, so the
 * button's disabled state and the warning box agree with each other without a round trip. The
 * inline owner picker reuses the same actionItem.update path as the Action items column itself —
 * assigning an owner here is indistinguishable from doing it there. */
function CloseRetroDialog({
  retroName,
  actionItems,
  teamMembers,
  defaultNextRetroAt,
  onUpdateOwner,
  onClose,
  onCancel,
}: {
  retroName: string;
  actionItems: ActionItem[];
  teamMembers: { id: string; displayName: string }[];
  defaultNextRetroAt: string;
  onUpdateOwner: (id: string, ownerId: string | null) => void;
  onClose: (nextRetroAt: string, override: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [nextRetroAt, setNextRetroAt] = useState(defaultNextRetroAt);
  const [submitting, setSubmitting] = useState<'close' | 'override' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ownerless = actionItems.filter((a) => (a.status === 'open' || a.status === 'in_progress') && !a.ownerId);

  async function submit(override: boolean) {
    setSubmitting(override ? 'override' : 'close');
    setError(null);
    try {
      await onClose(nextRetroAt, override);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close the retro.');
      setSubmitting(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Close ${retroName}?`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
    >
      <div style={{ width: 520, background: '#fff', borderRadius: 8, padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Close {retroName}?</h2>
        <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Next retro{' '}
          <input type="date" value={nextRetroAt} onChange={(e) => setNextRetroAt(e.target.value)} />
        </label>
        <p style={{ fontSize: 13 }}>
          {actionItems.length} action item{actionItems.length === 1 ? '' : 's'}
        </p>
        {ownerless.length > 0 && (
          <div style={{ background: '#fff8e1', border: '1px solid #f0c000', borderRadius: 6, padding: 8, marginBottom: 12 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 'bold' }}>
              {ownerless.length} item{ownerless.length === 1 ? '' : 's'} missing an owner
            </p>
            {ownerless.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ flex: 1, fontSize: 13 }}>{item.title}</span>
                <select
                  aria-label={`Owner for ${item.title}`}
                  value={item.ownerId ?? ''}
                  onChange={(e) => onUpdateOwner(item.id, e.target.value || null)}
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" style={{ color: 'crimson', fontSize: 13 }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onCancel} disabled={submitting !== null}>
            Cancel
          </button>
          {ownerless.length > 0 && (
            <button type="button" style={{ color: 'crimson' }} onClick={() => submit(true)} disabled={submitting !== null}>
              {submitting === 'override' ? 'Closing…' : 'Close anyway'}
            </button>
          )}
          <button type="button" onClick={() => submit(false)} disabled={ownerless.length > 0 || submitting !== null}>
            {submitting === 'close' ? 'Closing…' : 'Close retro'}
          </button>
        </div>
      </div>
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
  discussCurrent,
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
  // RN-019 layout spec: "the current topic's cards get a 2px blue outline" — Group's amber
  // `highlighted` and Discuss's blue `discussCurrent` never overlap (different phases), so there's
  // no conflict in letting both exist as separate flags rather than one generic "outline color".
  discussCurrent?: boolean;
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
      // RN-021 layout spec: "hovering [a summary source chip] outlines those cards on the board
      // and scrolls them into view" — this id is the one thing that makes the "scrolls into view"
      // half possible; the outline half already exists via `highlighted` above.
      id={`board-card-${card.id}`}
      style={{
        border: '1px solid #ccc',
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        outline: highlighted ? '2px solid #f59e0b' : discussCurrent ? '2px solid #2563eb' : undefined,
        outlineOffset: highlighted || discussCurrent ? -1 : undefined,
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
  discussCurrent,
  dimmed,
}: {
  card: VisibleBoardCard;
  canDrag: boolean;
  canEdit: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
  menu?: ReactNode;
  reactionProps: ReactionBarProps;
  highlighted?: boolean;
  discussCurrent?: boolean;
  // RN-019 layout spec: "all other cards dim to 40% opacity" — only ever set alongside
  // `discussCurrent`'s board-wide pass (Discuss phase), never together with `isDragging`'s own
  // opacity (cards aren't draggable during Discuss — allowedActions('discuss').cardDrag is
  // 'none' — so the two conditions below never actually compete for the same card).
  dimmed?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !canDrag,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : dimmed ? 0.4 : 1 }}
    >
      <CardView
        card={card}
        canEdit={canEdit}
        onEdit={onEdit}
        onDelete={onDelete}
        highlighted={highlighted}
        discussCurrent={discussCurrent}
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

/** Homework: group-summarizer's output, shown on the Vote page in place of the group's cards.
 * `null` (not yet generated — no API key, still in flight, or failed) renders as a plain
 * "Summarizing…" placeholder; the facilitator can edit either state (writing one from scratch is
 * the same action as correcting the AI's draft — see topicEditGroupSummary.ts's own comment).
 * Plain text only (CLAUDE.md: "summaries ... render as plain text only, never HTML or
 * Markdown") — rendered as ordinary JSX text content, never dangerouslySetInnerHTML. */
function GroupSummaryView({
  topic,
  canEdit,
  onEdit,
}: {
  topic: Topic;
  canEdit: boolean;
  onEdit: (title: string, summary: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(topic.groupSummaryTitle ?? '');
  const [draftSummary, setDraftSummary] = useState(topic.groupSummary ?? '');

  function startEditing() {
    setDraftTitle(topic.groupSummaryTitle ?? '');
    setDraftSummary(topic.groupSummary ?? '');
    setEditing(true);
  }

  function save() {
    const title = draftTitle.trim();
    const summary = draftSummary.trim();
    if (title && summary) onEdit(title, summary);
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ padding: 4 }}>
        <input
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="Summary title"
          aria-label="Summary title"
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', fontWeight: 'bold', marginBottom: 4 }}
        />
        <textarea
          value={draftSummary}
          onChange={(e) => setDraftSummary(e.target.value)}
          placeholder="Summary"
          aria-label="Summary text"
          rows={3}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
        />
        <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
          <button type="button" onClick={save}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 4 }}>
      {topic.groupSummary ? (
        <>
          <p style={{ margin: '0 0 4px', fontWeight: 'bold' }}>{topic.groupSummaryTitle}</p>
          <p style={{ margin: 0 }}>{topic.groupSummary}</p>
        </>
      ) : (
        <p style={{ margin: 0, color: '#666', fontStyle: 'italic' }}>Summarizing…</p>
      )}
      {canEdit && (
        <button type="button" onClick={startEditing} style={{ marginTop: 4, fontSize: 12 }}>
          Edit
        </button>
      )}
    </div>
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
  discussCurrent,
  dimmed,
  summaryView,
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
  // RN-019 layout spec: "the current topic's cards get a 2px blue outline; all other cards dim
  // to 40% opacity" — both `undefined` outside Discuss/Wrap up, same as the vote props above.
  discussCurrent?: boolean;
  dimmed?: boolean;
  // Homework: group-summarizer's output, rendered in place of the member cards list entirely —
  // "on the Vote page, the group summary replaces the cards." `undefined` outside Vote, where
  // cards render as usual.
  summaryView?: ReactNode;
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
      {summaryView ?? (
        <>
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
                discussCurrent={discussCurrent}
                dimmed={dimmed}
              />
            ),
          )}
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setExpanded(true)} style={{ fontSize: 12 }}>
              +{hiddenCount} more
            </button>
          )}
        </>
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

/** One row of the Discuss queue panel's "Up next" list (RN-019 layout spec: "rank, name, vote
 * count, drag handle for the facilitator"). The drag handle is a separate span from the row
 * itself — same reasoning as SortableCardView's dragHandleProps — so a participant (no handle,
 * no drag listeners) can still have the row be clickable to jump, without the two ever fighting
 * over the same pointer events. */
function UpNextRow({
  topic,
  rank,
  canManage,
  onJump,
}: {
  topic: Topic;
  rank: number;
  canManage: boolean;
  onJump: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: topic.id, disabled: !canManage });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 0',
      }}
    >
      {canManage && (
        <span {...attributes} {...listeners} style={{ cursor: 'grab', color: '#999' }} aria-label={`Reorder ${topic.name || 'this topic'}`}>
          ⠿
        </span>
      )}
      <span style={{ fontSize: 12, color: '#666', width: 14, flexShrink: 0 }}>{rank}</span>
      <button
        type="button"
        onClick={canManage ? onJump : undefined}
        disabled={!canManage}
        style={{
          flex: 1,
          textAlign: 'left',
          fontSize: 13,
          border: 'none',
          background: 'none',
          padding: 0,
          cursor: canManage ? 'pointer' : 'default',
          color: 'inherit',
        }}
      >
        {topic.name || 'Untitled group'}
      </button>
      <span style={{ fontSize: 12, color: '#666', flexShrink: 0 }}>
        {topic.voteCount} vote{topic.voteCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}

/** RN-020 layout spec: "the notes box from RN-020" lives in the "Now discussing" card. Debounces
 * 800ms of inactivity before actually sending — every keystroke updates local state instantly,
 * nothing is sent until typing pauses. `key={topicId}` at the call site forces a fresh mount (and
 * therefore fresh local state) whenever the current topic changes, rather than this component
 * trying to detect "that's a different topic now" itself. */
function NotesEditor({
  topicId,
  initialBody,
  canEdit,
  onSave,
}: {
  topicId: string;
  initialBody: string;
  canEdit: boolean;
  onSave: (topicId: string, body: string) => void;
}) {
  const [draft, setDraft] = useState(initialBody);
  const lastSavedRef = useRef(initialBody);

  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    const timeout = setTimeout(() => {
      lastSavedRef.current = draft;
      onSave(topicId, draft);
    }, 800);
    return () => clearTimeout(timeout);
  }, [draft, topicId, onSave]);

  if (!canEdit) {
    return draft ? <p style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{draft}</p> : null;
  }

  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      placeholder="Type notes…"
      aria-label="Topic notes"
      rows={3}
      maxLength={4000}
      style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
    />
  );
}

/** RN-021 layout spec: "hovering [a source chip] outlines those cards on the board and scrolls
 * them into view." A point with zero sources (always a facilitator's manual edit — see
 * topicSummaries.ts's own comment on why that's legitimate) simply has no chip to hover. */
function SummaryPointList({
  points,
  onHoverSources,
  renderAction,
}: {
  points: TopicSummaryPoint[];
  onHoverSources: (sources: string[] | null) => void;
  // RN-022: "Add as action item" on a proposed item — only ever passed for the proposedActionItems
  // list (SummaryCard), never key points/decisions/disagreements.
  renderAction?: (point: TopicSummaryPoint, index: number) => ReactNode;
}) {
  if (points.length === 0) return <p style={{ margin: '0 0 8px', fontSize: 12, color: '#999' }}>None.</p>;
  return (
    <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
      {points.map((p, i) => (
        <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
          {p.text}
          {renderAction?.(p, i)}
          {p.sources.length > 0 && (
            <button
              type="button"
              onMouseEnter={() => onHoverSources(p.sources)}
              onMouseLeave={() => onHoverSources(null)}
              onFocus={() => onHoverSources(p.sources)}
              onBlur={() => onHoverSources(null)}
              style={{
                marginLeft: 6,
                fontSize: 11,
                border: '1px solid #ddd',
                borderRadius: 999,
                padding: '0 6px',
                background: 'none',
                cursor: 'default',
              }}
            >
              {p.sources.length} card{p.sources.length === 1 ? '' : 's'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** RN-021: one topic's full summary card in the Summaries tab — "Summaries tab ... showing every
 * topic stacked in vote order." No mock distinguishes a one-topic "detail" view (reached by
 * clicking a Queue row) from the stacked list in Wrap up — this is deliberately the same
 * component either way, just scrolled to and briefly highlighted when opened from the Queue,
 * rather than a separate navigable detail screen with its own back arrow. */
function SummaryCard({
  topic,
  summary,
  unavailable,
  canManage,
  onHoverSources,
  onSave,
  onRegenerate,
  onAddActionItem,
  canAddActionItem,
}: {
  topic: Topic;
  summary: TopicSummary | null;
  unavailable: boolean;
  canManage: boolean;
  onHoverSources: (sources: string[] | null) => void;
  onSave: (
    keyPoints: TopicSummaryPoint[],
    decisions: TopicSummaryPoint[],
    disagreements: TopicSummaryPoint[],
    proposedActionItems: TopicSummaryPoint[],
  ) => void;
  onRegenerate: () => void;
  // RN-022: "'Add as action item' on a proposal pre-fills title and source topic" — available to
  // anyone, same as the rest of this panel (summaries are public; only editing is facilitator-only,
  // per topicSummaries.ts's own comment), not gated behind `canManage`.
  onAddActionItem: (text: string) => void;
  // RN-026: "no add ... " on a closed (read-only) retro — the mutation would already be rejected
  // server-side, but the button shouldn't be offered at all once there's nothing it can do.
  canAddActionItem: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // Local only — "Added" is feedback that this click already fired, not server state (nothing
  // here tracks whether an action item from this exact point still exists or was since deleted).
  const [addedIndices, setAddedIndices] = useState<Set<number>>(new Set());
  const [draftKeyPoints, setDraftKeyPoints] = useState('');
  const [draftDecisions, setDraftDecisions] = useState('');
  const [draftDisagreements, setDraftDisagreements] = useState('');
  const [draftProposedActionItems, setDraftProposedActionItems] = useState('');

  function linesToPoints(text: string): TopicSummaryPoint[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ text, sources: [] }));
  }
  function pointsToLines(points: TopicSummaryPoint[]): string {
    return points.map((p) => p.text).join('\n');
  }

  function startEditing() {
    if (!summary) return;
    setDraftKeyPoints(pointsToLines(summary.keyPoints));
    setDraftDecisions(pointsToLines(summary.decisions));
    setDraftDisagreements(pointsToLines(summary.disagreements));
    setDraftProposedActionItems(pointsToLines(summary.proposedActionItems));
    setEditing(true);
  }

  function save() {
    onSave(linesToPoints(draftKeyPoints), linesToPoints(draftDecisions), linesToPoints(draftDisagreements), linesToPoints(draftProposedActionItems));
    setEditing(false);
  }

  // Layout spec: "Regenerating an edited summary first asks 'Replace your edits?'."
  function regenerate() {
    if (summary?.edited && !window.confirm('Replace your edits?')) return;
    onRegenerate();
  }

  const cardStyle = { border: '1px solid #ddd', borderRadius: 8, padding: 8, marginBottom: 12 };

  if (!topic.startedAt) {
    return (
      <div id={`summary-card-${topic.id}`} style={cardStyle}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 'bold' }}>{topic.name || 'Untitled group'}</p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#999' }}>Not discussed</p>
      </div>
    );
  }

  return (
    <div id={`summary-card-${topic.id}`} style={cardStyle}>
      <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 'bold' }}>{topic.name || 'Untitled group'}</p>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#666' }}>
        {topic.voteCount} vote{topic.voteCount === 1 ? '' : 's'}
      </p>

      {/* "States: summarizing (skeleton and spinner)" — a topic that's ended (or is still the
          current one — generation only ever starts once it ends, see summarizeTopic.ts) with
          nothing stored and no failure reported yet. */}
      {!summary && !unavailable && (
        <>
          <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>Summarizing…</p>
          {[0, 1].map((i) => (
            <div key={i} style={{ height: 14, background: '#f0f0f0', borderRadius: 4, marginBottom: 6 }} />
          ))}
        </>
      )}

      {!summary && unavailable && (
        <div>
          <p style={{ fontSize: 12, color: '#b00020', margin: '0 0 8px' }}>Summary unavailable.</p>
          {canManage && (
            <button type="button" onClick={regenerate}>
              Retry
            </button>
          )}
        </div>
      )}

      {summary && !editing && (
        <>
          <p style={{ margin: '8px 0 2px', fontWeight: 'bold', fontSize: 12 }}>Key points</p>
          <SummaryPointList points={summary.keyPoints} onHoverSources={onHoverSources} />
          <p style={{ margin: '8px 0 2px', fontWeight: 'bold', fontSize: 12 }}>Decisions</p>
          <SummaryPointList points={summary.decisions} onHoverSources={onHoverSources} />
          <p style={{ margin: '8px 0 2px', fontWeight: 'bold', fontSize: 12 }}>Disagreements</p>
          <SummaryPointList points={summary.disagreements} onHoverSources={onHoverSources} />
          <p style={{ margin: '8px 0 2px', fontWeight: 'bold', fontSize: 12 }}>Proposed action items</p>
          <SummaryPointList
            points={summary.proposedActionItems}
            onHoverSources={onHoverSources}
            renderAction={
              canAddActionItem
                ? (p, i) =>
                    addedIndices.has(i) ? (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#666' }}>Added</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onAddActionItem(p.text);
                          setAddedIndices((s) => new Set(s).add(i));
                        }}
                        style={{ marginLeft: 6, fontSize: 11 }}
                      >
                        Add as action item
                      </button>
                    )
                : undefined
            }
          />

          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#666' }}>
            <span>v{summary.version}</span>
            {summary.edited && <span style={{ border: '1px solid #ddd', borderRadius: 999, padding: '0 6px' }}>Edited</span>}
            {canManage && (
              <>
                <button type="button" onClick={startEditing}>
                  Edit
                </button>
                <button type="button" onClick={regenerate}>
                  Regenerate
                </button>
              </>
            )}
          </div>
        </>
      )}

      {summary && editing && (
        <>
          <p style={{ margin: '0 0 2px', fontWeight: 'bold', fontSize: 12 }}>Key points</p>
          <textarea
            value={draftKeyPoints}
            onChange={(e) => setDraftKeyPoints(e.target.value)}
            rows={3}
            aria-label="Key points (one per line)"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, marginBottom: 8 }}
          />
          <p style={{ margin: '0 0 2px', fontWeight: 'bold', fontSize: 12 }}>Decisions</p>
          <textarea
            value={draftDecisions}
            onChange={(e) => setDraftDecisions(e.target.value)}
            rows={3}
            aria-label="Decisions (one per line)"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, marginBottom: 8 }}
          />
          <p style={{ margin: '0 0 2px', fontWeight: 'bold', fontSize: 12 }}>Disagreements</p>
          <textarea
            value={draftDisagreements}
            onChange={(e) => setDraftDisagreements(e.target.value)}
            rows={3}
            aria-label="Disagreements (one per line)"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, marginBottom: 8 }}
          />
          <p style={{ margin: '0 0 2px', fontWeight: 'bold', fontSize: 12 }}>Proposed action items</p>
          <textarea
            value={draftProposedActionItems}
            onChange={(e) => setDraftProposedActionItems(e.target.value)}
            rows={3}
            aria-label="Proposed action items (one per line)"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" onClick={save}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The 320px right-edge panel (RN-019 layout spec), open for everyone (not facilitator-gated,
 * unlike RN-017's SuggestionsPanel — "Voter sees own... Others see progress" precedent doesn't
 * apply here, the whole queue is public once Discuss starts). Two tabs: Queue (RN-019) and
 * Summaries (RN-021, "the Summaries tab of the right panel"). */
function DiscussQueuePanel({
  phase,
  topics,
  cardCountByTopic,
  canManage,
  onNext,
  onFinish,
  onJump,
  onReorder,
  canEditNotes,
  onNotesChange,
  tab,
  onTabChange,
  topicSummaries,
  summaryUnavailableTopicIds,
  onHoverSummarySources,
  onSaveSummary,
  onRegenerateSummary,
  onAddActionItem,
  attendees,
}: {
  phase: RetroPhase;
  topics: Topic[];
  cardCountByTopic: Map<string, number>;
  canManage: boolean;
  onNext: () => void;
  onFinish: () => void;
  onJump: (topicId: string) => void;
  onReorder: (topicId: string, discussionOrder: string) => void;
  // RN-020: "editable only in Discuss and Wrap up" — no ownership check beyond that (unlike
  // `canManage`'s facilitator-only queue controls above), so this is its own separate flag.
  canEditNotes: boolean;
  onNotesChange: (topicId: string, body: string) => void;
  // RN-021: "two tabs: Queue and Summaries." Lifted to the caller (not local state) because
  // clicking a Discussed row needs to switch tabs from inside the Queue tab's own content, and
  // entering Wrap up defaults the tab for the whole panel — both are easier to drive from one
  // place than threaded back up through this component.
  tab: 'queue' | 'summaries';
  onTabChange: (tab: 'queue' | 'summaries') => void;
  topicSummaries: TopicSummary[];
  summaryUnavailableTopicIds: string[];
  onHoverSummarySources: (sources: string[] | null) => void;
  onSaveSummary: (
    topicId: string,
    keyPoints: TopicSummaryPoint[],
    decisions: TopicSummaryPoint[],
    disagreements: TopicSummaryPoint[],
    proposedActionItems: TopicSummaryPoint[],
  ) => void;
  onRegenerateSummary: (topicId: string) => void;
  onAddActionItem: (topicId: string, text: string) => void;
  attendees: { id: string; displayName: string }[];
}) {
  const current = topics.find((t) => t.startedAt && !t.endedAt) ?? null;
  const upNext = topics
    .filter((t) => !t.startedAt)
    .sort((a, b) => (a.discussionOrder ?? '').localeCompare(b.discussionOrder ?? ''));
  const discussed = topics.filter((t) => t.endedAt).sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''));
  const isLastTopic = upNext.length === 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Ordinary dnd-kit sortable reordering (unlike the board's own DndContext, this list has no
  // competing "drop on center" gesture, so the default live-preview strategy is exactly right
  // here rather than something to work around — see BoardPage.tsx's noSortPreview for why the
  // board's own list disables it).
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || over.id === active.id) return;
    const activeIndex = upNext.findIndex((t) => t.id === active.id);
    const overIndex = upNext.findIndex((t) => t.id === over.id);
    if (activeIndex === -1 || overIndex === -1) return;
    const reordered = arrayMove(upNext, activeIndex, overIndex);
    const newIndex = reordered.findIndex((t) => t.id === active.id);
    const prev = reordered[newIndex - 1];
    const next = reordered[newIndex + 1];
    onReorder(active.id as string, generateKeyBetween(prev?.discussionOrder ?? null, next?.discussionOrder ?? null));
  }

  const sortedTopics = [...topics].sort((a, b) => (a.discussionOrder ?? '').localeCompare(b.discussionOrder ?? ''));

  return (
    <div style={{ width: 320, flexShrink: 0 }}>
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => onTabChange('queue')}
            style={{ fontWeight: tab === 'queue' ? 'bold' : 'normal', textDecoration: tab === 'queue' ? 'underline' : undefined }}
          >
            Queue
          </button>
          <button
            type="button"
            onClick={() => onTabChange('summaries')}
            style={{ fontWeight: tab === 'summaries' ? 'bold' : 'normal', textDecoration: tab === 'summaries' ? 'underline' : undefined }}
          >
            Summaries
          </button>
        </div>

        {tab === 'queue' && current && (
          <div style={{ border: '2px solid #2563eb', borderRadius: 6, padding: 8, marginBottom: 12 }}>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: '#2563eb', fontWeight: 'bold' }}>Now discussing</p>
            <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 'bold' }}>{current.name || 'Untitled group'}</p>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#666' }}>
              {current.voteCount} vote{current.voteCount === 1 ? '' : 's'} · {cardCountByTopic.get(current.id) ?? 0} card
              {(cardCountByTopic.get(current.id) ?? 0) === 1 ? '' : 's'}
            </p>
            {/* Homework: question-suggester's output — written the moment this topic became
                current (discussHelpers.ts's startTopic); null until it runs. */}
            {current.discussionQuestions && current.discussionQuestions.length > 0 && (
              <ul style={{ margin: '0 0 8px', paddingLeft: 16, fontSize: 12 }}>
                {current.discussionQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            )}
            <div style={{ marginBottom: 8 }}>
              <NotesEditor
                key={current.id}
                topicId={current.id}
                initialBody={current.notes}
                canEdit={canEditNotes}
                onSave={onNotesChange}
              />
            </div>
            {canManage && (
              <button type="button" onClick={isLastTopic ? onFinish : onNext}>
                {isLastTopic ? 'Finish discussion' : 'Next topic'}
              </button>
            )}
          </div>
        )}

        {tab === 'queue' && phase === 'discuss' && upNext.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: '0 0 4px', fontWeight: 'bold', fontSize: 12, color: '#666' }}>Up next</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={upNext.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {upNext.map((t, i) => (
                  <UpNextRow key={t.id} topic={t} rank={i + 1} canManage={canManage} onJump={() => onJump(t.id)} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}

        {tab === 'queue' && (
          <div style={{ marginBottom: phase === 'wrap_up' ? 12 : 0 }}>
            <p style={{ margin: '0 0 4px', fontWeight: 'bold', fontSize: 12, color: '#666' }}>Discussed</p>
            {discussed.length === 0 && <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Nothing discussed yet.</p>}
            {discussed.map((t) => {
              // RN-021: "Clicking a discussed topic in the Queue opens its summary there" — a
              // read-only navigation available to everyone, not the facilitator-only queue jump
              // (`onJump`) this row used before summaries existed.
              const status = topicSummaries.some((s) => s.topicId === t.id)
                ? 'Ready'
                : summaryUnavailableTopicIds.includes(t.id)
                  ? 'Unavailable'
                  : 'Summarizing…';
              return (
                <div
                  key={t.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    onTabChange('summaries');
                    setTimeout(() => document.getElementById(`summary-card-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onTabChange('summaries');
                      setTimeout(() => document.getElementById(`summary-card-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
                    }
                  }}
                >
                  <span aria-hidden="true">✓</span>
                  <span style={{ flex: 1, fontSize: 13 }}>{t.name || 'Untitled group'}</span>
                  <span style={{ fontSize: 11, color: '#666', border: '1px solid #ddd', borderRadius: 999, padding: '1px 6px' }}>{status}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* "Undiscussed topics are labeled 'not discussed' in Wrap up" — during Discuss itself
            the exact same topics already render above as "Up next"; this section only exists
            once that list stops being meaningful (reordering/jumping both end with Discuss). */}
        {tab === 'queue' && phase === 'wrap_up' && upNext.length > 0 && (
          <div>
            <p style={{ margin: '0 0 4px', fontWeight: 'bold', fontSize: 12, color: '#666' }}>Not discussed</p>
            {upNext.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', color: '#999' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{t.name || 'Untitled group'}</span>
                <span style={{ fontSize: 11 }}>Not discussed</span>
              </div>
            ))}
          </div>
        )}

        {/* RN-021: "the Summaries tab ... showing every topic stacked in vote order" — every
            topic, not just discussed ones (SummaryCard itself renders the right state for
            not-yet-started, in-progress, ready, or failed). */}
        {tab === 'summaries' && (
          <div>
            {sortedTopics.map((t) => (
              <SummaryCard
                key={t.id}
                topic={t}
                summary={topicSummaries.find((s) => s.topicId === t.id) ?? null}
                unavailable={summaryUnavailableTopicIds.includes(t.id)}
                canManage={canManage}
                onHoverSources={onHoverSummarySources}
                onSave={(keyPoints, decisions, disagreements, proposedActionItems) =>
                  onSaveSummary(t.id, keyPoints, decisions, disagreements, proposedActionItems)
                }
                onRegenerate={() => onRegenerateSummary(t.id)}
                onAddActionItem={(text) => onAddActionItem(t.id, text)}
                canAddActionItem={phase !== 'closed'}
              />
            ))}
            {/* RN-026: "attendance" — only ever shown once the retro's actually closed, the one
                new thing this story's summaries panel adds beyond what RN-021 already built. */}
            {phase === 'closed' && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
                <p style={{ margin: '0 0 2px', fontWeight: 'bold' }}>Attendance</p>
                <p style={{ margin: 0 }}>
                  {attendees.length > 0 ? attendees.map((a) => a.displayName).join(', ') : 'No attendance recorded.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
        topicSummaries: initialBoard.topicSummaries,
        summaryUnavailableTopicIds: [],
        actionItems: initialBoard.actionItems,
        actionItemReviewOutcomes: initialBoard.actionItemReviewOutcomes,
        teamMembers: initialBoard.teamMembers,
        attendees: initialBoard.attendees,
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
  // RN-023: the "Close retro" header button opens this; closed by Cancel or a successful close
  // (the dialog's own component manages its submitting/error state, not this board).
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
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

  // RN-019: the current topic is simply whichever one has `startedAt` set and `endedAt` still
  // null (topics.ts's own comment) — never more than one, since topic.next/topic.setCurrent
  // always end the old one before starting a new one.
  const currentDiscussTopic = board.topics.find((t) => t.startedAt && !t.endedAt) ?? null;
  // "Board: the current topic's cards get a 2px blue outline; all other cards dim to 40%
  // opacity" — both only apply once there's an actual current topic to contrast against
  // (Discuss, and whatever's left of it carried into Wrap up).
  const discussDimmingActive = currentDiscussTopic !== null;
  const cardCountByTopic = new Map<string, number>();
  for (const card of board.cards) {
    if (card.topicId) cardCountByTopic.set(card.topicId, (cardCountByTopic.get(card.topicId) ?? 0) + 1);
  }
  // RN-020: "editable only in Discuss and Wrap up" — matrix's own `summaryEdit` cell, no
  // ownership check (the story never says "facilitator-only").
  const canEditNotes = allowedActions(board.phase).summaryEdit;

  // RN-017: AI grouping suggestions — facilitator-only panel state. `suggestions` starts from
  // the initial snapshot (a reload mid-Group picks up whatever was already pending) and is
  // otherwise only ever added to by the worker's one-shot `group.suggestions` broadcast (see the
  // user:{id} channel listener below) — never re-fetched.
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>(initialBoard.suggestions ?? []);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsPanelOpen, setSuggestionsPanelOpen] = useState(false);
  // RN-021 layout spec: "two tabs: Queue and Summaries... In Wrap up the panel opens on
  // Summaries." Defaulted here (not inside DiscussQueuePanel) so the same effect below that
  // already reacts to phase transitions can set it on entering Wrap up, without that component
  // needing its own copy of "was the previous phase discuss." The initial value also covers
  // loading straight into Wrap up or Closed (no live transition to react to) — RN-026: a reader
  // opening a closed retro wants the recap, not the queue tab's now-inert manage controls.
  const [rightPanelTab, setRightPanelTab] = useState<'queue' | 'summaries'>(
    initialBoard.retro.phase === 'wrap_up' || initialBoard.retro.phase === 'closed' ? 'summaries' : 'queue',
  );
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
  // RN-021: "hovering a point highlights its source cards" — the same amber outline suggestion-
  // hover already uses, just driven by a second, independent hover source. The two never overlap
  // in practice (suggestions only exist in Group, summary points only exist in Discuss/Wrap up).
  const [hoveredSummarySourceIds, setHoveredSummarySourceIds] = useState<string[] | null>(null);
  const highlightedCardIds = new Set([
    ...(hoveredSuggestionId ? (suggestions.find((s) => s.id === hoveredSuggestionId)?.cardIds ?? []) : []),
    ...(hoveredSummarySourceIds ?? []),
  ]);

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
          discussionOrder: null,
          startedAt: null,
          endedAt: null,
          groupSummaryTitle: null,
          groupSummary: null,
          discussionQuestions: null,
          notes: '',
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

  // Homework: "the facilitator to be able to edit the summary during the voting phase."
  function editGroupSummary(topicId: string, title: string, summary: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => ({
        ...b,
        topics: b.topics.map((t) => (t.id === topicId ? { ...t, groupSummaryTitle: title, groupSummary: summary } : t)),
      }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'topic.editGroupSummary', payload: { topicId, title, summary } }),
    });
  }

  // RN-020: "notes save automatically" — called by NotesEditor's own 800ms debounce, not on
  // every keystroke.
  function updateNotes(topicId: string, body: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => ({ ...b, topics: b.topics.map((t) => (t.id === topicId ? { ...t, notes: body } : t)) }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'note.upsert', payload: { topicId, body } }),
    });
  }

  // RN-021: "hovering [a source chip] outlines those cards on the board and scrolls them into
  // view" — the outline is just highlightedCardIds (set above); the scroll only happens once, on
  // hover-in, not continuously, so it doesn't fight a user who scrolls away themselves.
  function hoverSummarySources(sources: string[] | null) {
    setHoveredSummarySourceIds(sources);
    if (sources && sources[0]) {
      document.getElementById(`board-card-${sources[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function editSummary(
    topicId: string,
    keyPoints: TopicSummaryPoint[],
    decisions: TopicSummaryPoint[],
    disagreements: TopicSummaryPoint[],
    proposedActionItems: TopicSummaryPoint[],
  ) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      // No optimistic shortcut — the real result (TopicEditSummaryResult.summary) carries the
      // full row (id, version, edited, etc.), which there's nothing useful to guess here.
      optimisticReduce: (b) => b,
      send: () =>
        postMutation(accessToken, retroId, {
          mutationId,
          type: 'topic.editSummary',
          payload: { topicId, keyPoints, decisions, disagreements, proposedActionItems },
        }),
    });
  }

  // RN-021: "each regenerate creates a new version row" — written later by the job, not this
  // mutation's own result (see topicRegenerateSummary.ts's own comment). "Replace your edits?" is
  // confirmed by the caller (SummaryCard) before this is ever called, not here.
  function regenerateSummary(topicId: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => b,
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'topic.regenerateSummary', payload: { topicId } }),
    });
  }

  // RN-022: manual creation (sourceTopicId null) and "Add as action item" on a proposal
  // (sourceTopicId set, origin 'ai') both go through this one function — the only difference
  // between them is which arguments the caller already has in hand.
  function createActionItem(title: string, sourceTopicId: string | null, ownerId: string | null, dueDate: string | null, origin: 'ai' | 'manual') {
    const id = uuidv7();
    const mutationId = uuidv7();
    const now = new Date().toISOString();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) =>
        reduceBoard(b, {
          seq: -1,
          type: 'actionItem.create',
          payload: {
            actionItem: {
              id,
              sourceRetroId: retroId,
              sourceTopicId,
              title,
              ownerId,
              dueDate,
              status: 'open',
              origin,
              completedAt: null,
              createdAt: now,
              updatedAt: now,
            },
          },
        }),
      send: () =>
        postMutation(accessToken, retroId, {
          mutationId,
          type: 'actionItem.create',
          payload: { id, title, sourceTopicId, ownerId, dueDate, origin },
        }),
    });
  }

  // RN-022: "owner and due date changes sync to all browsers" — title isn't inline-editable (only
  // ever set at creation), so this never touches it.
  function updateActionItem(id: string, patch: { ownerId?: string | null; dueDate?: string | null }) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => ({ ...b, actionItems: b.actionItems.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'actionItem.update', payload: { id, ...patch } }),
    });
  }

  // RN-025: Review's four quick actions on a carried-over item. Only done/in_progress/dropped
  // change the item's own status (and completedAt) — 'carried' ("Keep open") only ever touches
  // the review outcome itself, same split actionItemReview.ts enforces server-side.
  function reviewActionItem(actionItemId: string, outcome: ActionItemReviewOutcome) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => {
        const changesStatus = outcome === 'done' || outcome === 'in_progress' || outcome === 'dropped';
        const actionItems = changesStatus
          ? b.actionItems.map((a) =>
              a.id === actionItemId ? { ...a, status: outcome, completedAt: outcome === 'done' ? new Date().toISOString() : null } : a,
            )
          : b.actionItems;
        const actionItemReviewOutcomes = [
          ...b.actionItemReviewOutcomes.filter((o) => o.actionItemId !== actionItemId),
          { actionItemId, outcome },
        ];
        return { ...b, actionItems, actionItemReviewOutcomes };
      },
      send: () =>
        postMutation(accessToken, retroId, { mutationId, type: 'actionItem.review', payload: { actionItemId, outcome } }),
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

  // RN-019: no optimistic shortcut — the real result (a full {endedTopic, startedTopic} pair) is
  // what actually carries the ended/started topics' timestamps, and "which topic is next" isn't
  // something this client can reliably guess without the server's own queue-order knowledge
  // (same reasoning as acceptSuggestion's own "no optimistic shortcut").
  function topicNext() {
    const mutationId = uuidv7();
    return sendMutation({
      mutationId,
      optimisticReduce: (b) => b,
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'topic.next', payload: {} }),
    });
  }

  // "Finish discussion" (RN-019 layout spec, last topic's button): ends the last topic via the
  // same topic.next the rest of the queue uses, then also advances the retro's own phase —
  // topics and phase are different concerns with their own mutations elsewhere in this file too,
  // so this is two calls fired from one button rather than teaching topic.next about phases.
  //
  // Bug found live: these two calls used to fire without waiting for the first — topic.next is
  // Discuss-phase-only server-side (topicNext.ts), and phase.skip's own request can reach the
  // server and commit *first* (it's a smaller transaction), flipping the phase to wrap_up before
  // topic.next's request is even processed there, which then rejects with "topic.next is not
  // allowed during wrap_up." Awaiting topic.next first guarantees the phase is still Discuss when
  // it runs, matching topicNext.ts's own comment ("BoardPage.tsx is what also calls phase.next
  // right after" — after, not concurrently).
  function finishDiscussion() {
    void topicNext().then(() => changePhase('skip'));
  }

  function jumpToTopic(topicId: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => b,
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'topic.setCurrent', payload: { topicId } }),
    });
  }

  function reorderQueueTopic(topicId: string, discussionOrder: string) {
    const mutationId = uuidv7();
    void sendMutation({
      mutationId,
      optimisticReduce: (b) => ({ ...b, topics: b.topics.map((t) => (t.id === topicId ? { ...t, discussionOrder } : t)) }),
      send: () => postMutation(accessToken, retroId, { mutationId, type: 'queue.reorder', payload: { topicId, discussionOrder } }),
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
              topicSummaries: fresh.topicSummaries,
              // A resync is a hard reset against a fresh snapshot — any "unavailable" flag was
              // either resolved (a summary exists now) or still true server-side with no event
              // of its own to resurrect it from, so there's nothing to carry over here either way.
              summaryUnavailableTopicIds: [],
              actionItems: fresh.actionItems,
              actionItemReviewOutcomes: fresh.actionItemReviewOutcomes,
              teamMembers: fresh.teamMembers,
              attendees: fresh.attendees,
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
      // Homework: the two AI agents' own one-shot worker broadcasts — not retro_events mutations
      // (no seq, nothing for applyServerEvent's ordering to key off of), same reasoning as
      // group.suggestions on the user channel below, just sent to everyone here instead of only
      // the facilitator. Patched in directly rather than seq-gated.
      if (message.event === 'topic.groupSummaryReady') {
        const { topicId, title, summary } = message.payload as { topicId: string; title: string; summary: string };
        applyLocalPatch((b) => ({
          ...b,
          topics: b.topics.map((t) => (t.id === topicId ? { ...t, groupSummaryTitle: title, groupSummary: summary } : t)),
        }));
        return;
      }
      if (message.event === 'topic.questionsReady') {
        const { topicId, questions } = message.payload as { topicId: string; questions: string[] };
        applyLocalPatch((b) => ({
          ...b,
          topics: b.topics.map((t) => (t.id === topicId ? { ...t, discussionQuestions: questions } : t)),
        }));
        return;
      }
      // RN-021: ai.summarizeTopic's own one-shot broadcasts — same reasoning as the two above,
      // just for the real end-of-discussion summary instead of the homework's lighter one.
      if (message.event === 'topic.summaryReady') {
        const { summary } = message.payload as { topicId: string; summary: TopicSummary };
        applyLocalPatch((b) => {
          const existing = b.topicSummaries.find((s) => s.topicId === summary.topicId);
          return {
            ...b,
            topicSummaries: existing
              ? b.topicSummaries.map((s) => (s.topicId === summary.topicId ? summary : s))
              : [...b.topicSummaries, summary],
            summaryUnavailableTopicIds: b.summaryUnavailableTopicIds.filter((id) => id !== summary.topicId),
          };
        });
        return;
      }
      if (message.event === 'topic.summaryFailed') {
        const { topicId } = message.payload as { topicId: string };
        applyLocalPatch((b) => ({
          ...b,
          summaryUnavailableTopicIds: b.summaryUnavailableTopicIds.includes(topicId)
            ? b.summaryUnavailableTopicIds
            : [...b.summaryUnavailableTopicIds, topicId],
        }));
        return;
      }
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
    if (previousPhaseRef.current === 'discuss' && board.phase === 'wrap_up') {
      setRightPanelTab('summaries');
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

  // RN-023: bypasses sendMutation's optimistic/rollback plumbing deliberately — the dialog needs
  // its own inline error ("error (inline message, dialog stays open)" per the layout spec), not
  // the board's global `lastError` banner, and there's nothing useful to guess optimistically for
  // a one-shot close. On success, the real phase change arrives the same way every other client's
  // does: through the broadcast (same `retro:{retroId}` channel this browser is already on).
  async function closeRetro(nextRetroAt: string, override: boolean) {
    const mutationId = uuidv7();
    const res = await postMutation(accessToken, retroId, { mutationId, type: 'retro.close', payload: { nextRetroAt, override } });
    if (!res.ok) {
      const message = await res
        .json()
        .then((body: { message?: string; error?: string }) => body.message ?? body.error)
        .catch(() => undefined);
      throw new Error(message ?? `Failed to close the retro (${res.status}).`);
    }
    setCloseDialogOpen(false);
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
          {/* RN-023: wrap_up's "Skip" is replaced by this dialog-opening button — phase.skip (same
              mutation type as phase.next) is rejected server-side for that specific target now,
              so this is the only door from here to Closed. */}
          {board.phase === 'wrap_up' ? (
            <button type="button" onClick={() => setCloseDialogOpen(true)}>
              Close retro
            </button>
          ) : (
            nextPhase(board.phase) && (
              <button type="button" onClick={() => changePhase('skip')}>
                Skip
              </button>
            )
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
                const canEdit = canEditColumn(column.kind);
                // RN-022: action_items has no column_id FK at all (unlike cards) — it renders
                // `board.actionItems` directly instead of anything filtered from `board.cards`.
                if (column.kind === 'action_items') {
                  const items = [...board.actionItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
                  return (
                    <DroppableColumn key={column.id} column={column}>
                      <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>
                        {column.title} <span style={{ fontWeight: 'normal', color: '#666' }}>({items.length})</span>
                      </h2>
                      {column.prompt && <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>{column.prompt}</p>}
                      {items.map((item) => (
                        <ActionItemRow
                          key={item.id}
                          item={item}
                          teamMembers={board.teamMembers}
                          canEdit={canEdit}
                          onUpdate={(patch) => updateActionItem(item.id, patch)}
                          isCarriedOver={board.phase === 'review' && item.sourceRetroId !== retroId}
                          reviewOutcome={board.actionItemReviewOutcomes.find((o) => o.actionItemId === item.id)?.outcome ?? null}
                          onReview={(outcome) => reviewActionItem(item.id, outcome)}
                        />
                      ))}
                      {canEdit && (
                        <AddActionItemForm
                          teamMembers={board.teamMembers}
                          defaultDueDate={defaultActionItemDueDate(initialBoard.retro)}
                          onAdd={(title, ownerId, dueDate) => createActionItem(title, null, ownerId, dueDate, 'manual')}
                        />
                      )}
                    </DroppableColumn>
                  );
                }
                const cards = board.cards
                  .filter((c) => c.columnId === column.id)
                  .sort((a, b) => a.position.localeCompare(b.position));
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
                              discussCurrent={false}
                              // Bug: action items are a persistent list, not part of any
                              // "current topic" — group->vote's auto-topic-wrap never touches
                              // that column, so its cards always render as bare 'card' rows here,
                              // and dimming them (even just visually — the Edit/Delete buttons
                              // were never actually disabled) made them look uneditable during
                              // Discuss/Wrap up, when they're exactly the phases action items are
                              // meant to be worked on.
                              dimmed={column.kind === 'standard' && discussDimmingActive}
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
                            discussCurrent={discussDimmingActive && row.topic.id === currentDiscussTopic?.id}
                            dimmed={discussDimmingActive && row.topic.id !== currentDiscussTopic?.id}
                            summaryView={
                              board.phase === 'vote' ? (
                                <GroupSummaryView
                                  topic={row.topic}
                                  canEdit={isFacilitator}
                                  onEdit={(title, summary) => editGroupSummary(row.topic.id, title, summary)}
                                />
                              ) : undefined
                            }
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
        {/* RN-026: closed is read-only — the Summaries tab (defaulted below) is the recap view a
            member who missed the retro actually wants; the Queue tab's manage controls
            (canManage) are hidden rather than left to fail server-side on click. */}
        {(board.phase === 'discuss' || board.phase === 'wrap_up' || board.phase === 'closed') && (
          <DiscussQueuePanel
            phase={board.phase}
            topics={board.topics}
            cardCountByTopic={cardCountByTopic}
            canManage={isFacilitator && board.phase !== 'closed'}
            onNext={topicNext}
            onFinish={finishDiscussion}
            onJump={jumpToTopic}
            onReorder={reorderQueueTopic}
            canEditNotes={canEditNotes}
            onNotesChange={updateNotes}
            tab={rightPanelTab}
            onTabChange={setRightPanelTab}
            topicSummaries={board.topicSummaries}
            summaryUnavailableTopicIds={board.summaryUnavailableTopicIds}
            onHoverSummarySources={hoverSummarySources}
            onSaveSummary={editSummary}
            onRegenerateSummary={regenerateSummary}
            onAddActionItem={(topicId, text) => createActionItem(text, topicId, null, defaultActionItemDueDate(initialBoard.retro), 'ai')}
            attendees={board.attendees}
          />
        )}
      </div>
      {footerHint(board.phase) && <p style={{ marginTop: 24, color: '#666', fontSize: 13 }}>{footerHint(board.phase)}</p>}
      {closeDialogOpen && (
        <CloseRetroDialog
          retroName={initialBoard.retro.name}
          actionItems={board.actionItems}
          teamMembers={board.teamMembers}
          defaultNextRetroAt={defaultNextRetroDate(initialBoard.retro)}
          onUpdateOwner={(id, ownerId) => updateActionItem(id, { ownerId })}
          onClose={closeRetro}
          onCancel={() => setCloseDialogOpen(false)}
        />
      )}
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
