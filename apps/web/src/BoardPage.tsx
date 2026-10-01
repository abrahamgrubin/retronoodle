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
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { generateKeyBetween } from 'fractional-indexing';
import {
  allowedActions,
  defaultTopicName,
  footerHint,
  nextPhase,
  phaseDurationMinutes,
  phaseSubtitle,
  previousPhase,
  type BoardCard,
  type BoardColumn,
  type BoardResponse,
  type RetroPhase,
  type Topic,
  type VisibleBoardCard,
} from '@retronoodle/shared';
import { signInWithGoogle } from './auth';
import { fetchBoard } from './board';
import { reduceBoard, type BoardState } from './boardReducer';
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

function CardView({
  card,
  canEdit,
  onEdit,
  onDelete,
  dragHandleProps,
  menu,
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
    <div style={{ border: '1px solid #ccc', borderRadius: 6, padding: 8, marginBottom: 8 }} {...dragHandleProps}>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{card.body}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>{card.authorName}</p>
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
}: {
  card: VisibleBoardCard;
  canDrag: boolean;
  canEdit: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
  menu?: ReactNode;
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
        dragHandleProps={canDrag ? { ...attributes, ...listeners } : undefined}
        menu={menu}
      />
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
        const topic: Topic = { id: topicId, columnId: first.columnId, name: !first.hidden ? defaultTopicName(first.body) : 'New group' };
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

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
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
    previousPhaseRef.current = board.phase;
  }, [board.phase]);

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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {board.columns
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((column) => {
              const cards = board.cards
                .filter((c) => c.columnId === column.id)
                .sort((a, b) => a.position.localeCompare(b.position));
              const canEdit = canEditColumn(column.kind);
              const rows = buildColumnRows(cards, board.topics);
              // Kept in sync with rendered (grouped) order, not raw position order, so dnd-kit's
              // own notion of item order matches the DOM it's actually measuring.
              const sortableIds = rows.flatMap((row) =>
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
              return (
                <DroppableColumn key={column.id} column={column}>
                  <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>
                    {column.title} <span style={{ fontWeight: 'normal', color: '#666' }}>({cards.length})</span>
                  </h2>
                  {column.prompt && <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>{column.prompt}</p>}
                  <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                    {rows.map((row) =>
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
              <CardView card={activeCard} canEdit={false} onEdit={() => {}} onDelete={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
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
