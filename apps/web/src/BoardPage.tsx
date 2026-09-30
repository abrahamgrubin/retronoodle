import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { uuidv7 } from 'uuidv7';
import {
  allowedActions,
  footerHint,
  nextPhase,
  phaseSubtitle,
  previousPhase,
  type BoardResponse,
  type RetroPhase,
  type VisibleBoardCard,
} from '@retronoodle/shared';
import { signInWithGoogle } from './auth';
import { fetchBoard } from './board';
import { reduceBoard, type BoardState } from './boardReducer';
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
}: {
  card: VisibleBoardCard;
  canEdit: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
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
    <div style={{ border: '1px solid #ccc', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{card.body}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>{card.authorName}</p>
      {canEdit && (
        <div style={{ marginTop: 4 }}>
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>{' '}
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
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
  const [useBoardStore] = useState(() =>
    createRetroStore<BoardState>({
      initialBoard: {
        phase: initialBoard.retro.phase,
        cardsRevealed: initialBoard.retro.cardsRevealed,
        columns: initialBoard.columns,
        cards: initialBoard.cards,
      },
      initialSeq: initialBoard.seq,
      reduce: reduceBoard,
    }),
  );
  const { board, lastError, applyServerEvent, applyLocalPatch, resetBoard, sendMutation, clearError } = useBoardStore();
  const isFacilitator = userId === initialBoard.retro.facilitatorId;
  // The Action items column follows the matrix's separate "Create or edit action items" row
  // (Review/Discuss/Wrap up), not "Add, edit, delete own card" (Write/Group) — matching the
  // server-side check in cardCreate/cardEdit/cardDelete's apply().
  function canEditColumn(columnKind: 'standard' | 'action_items'): boolean {
    const actions = allowedActions(board.phase);
    return columnKind === 'action_items' ? actions.actionItemEdit : actions.cardCrud;
  }

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const retroChannel = client.channel(`retro:${retroId}`, { config: { private: true } });
    retroChannel.on('broadcast', { event: '*' }, (message) => {
      const { seq, result } = message.payload as { seq: number; result: unknown };
      applyServerEvent({ seq, type: message.event, payload: result });
    });
    retroChannel.subscribe();

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
      void client.removeChannel(retroChannel);
      void client.removeChannel(userChannel);
    };
  }, [retroId, userId, applyServerEvent, applyLocalPatch]);

  // RN-011: "Reveal happens ... on write -> group", but the transition's own broadcast only
  // carries the new phase, not every card's real text (see onTransition.ts's write->group
  // comment for why) — so once Write ends, refetch once to pick up what was hidden a moment ago.
  const previousPhaseRef = useRef(board.phase);
  useEffect(() => {
    if (previousPhaseRef.current === 'write' && board.phase !== 'write') {
      void fetchBoard(accessToken, retroId).then((fresh) => {
        resetBoard(
          { phase: fresh.retro.phase, cardsRevealed: fresh.retro.cardsRevealed, columns: fresh.columns, cards: fresh.cards },
          fresh.seq,
        );
      });
    }
    previousPhaseRef.current = board.phase;
  }, [board.phase, accessToken, retroId, resetBoard]);

  function addCard(columnId: string, body: string) {
    const cardId = uuidv7();
    const now = new Date().toISOString();
    void sendMutation({
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
      send: () =>
        postMutation(accessToken, retroId, { mutationId: uuidv7(), type: 'card.create', payload: { cardId, columnId, body } }),
    });
  }

  function editCard(cardId: string, body: string) {
    void sendMutation({
      // A local-only patch, not reduceBoard's card.edit branch: that branch expects the server's
      // full authoritative card (RN-011), and all a caller-initiated edit has is the new body.
      optimisticReduce: (b) => ({
        ...b,
        cards: b.cards.map((c) => (c.id === cardId && !c.hidden ? { ...c, body } : c)),
      }),
      send: () => postMutation(accessToken, retroId, { mutationId: uuidv7(), type: 'card.edit', payload: { cardId, body } }),
    });
  }

  function deleteCard(cardId: string) {
    void sendMutation({
      optimisticReduce: (b) => reduceBoard(b, { seq: -1, type: 'card.delete', payload: { id: cardId } }),
      send: () => postMutation(accessToken, retroId, { mutationId: uuidv7(), type: 'card.delete', payload: { cardId } }),
    });
  }

  function revealCards() {
    void sendMutation({
      // No optimistic shortcut — the real cards.reveal broadcast (arriving shortly after) is
      // what actually carries every hidden card's text; there's nothing useful to guess here.
      optimisticReduce: (b) => b,
      send: () => postMutation(accessToken, retroId, { mutationId: uuidv7(), type: 'cards.reveal', payload: {} }),
    });
  }

  function changePhase(direction: 'next' | 'back') {
    const type = direction === 'next' ? 'phase.next' : 'phase.back';
    const target = direction === 'next' ? nextPhase(board.phase) : previousPhase(board.phase);
    if (!target) return;
    void sendMutation({
      optimisticReduce: (b) => reduceBoard(b, { seq: -1, type, payload: { phase: target } }),
      send: () => postMutation(accessToken, retroId, { mutationId: uuidv7(), type, payload: {} }),
    });
  }

  // Header pill bar per mock (RN-010): current phase is the dark pill; past phases stay
  // clickable-looking but inert — there's no "jump to phase" action, only next/back/skip.
  const PHASE_PILLS: RetroPhase[] = ['review', 'write', 'group', 'vote', 'discuss', 'wrap_up'];
  const currentPillIndex = PHASE_PILLS.indexOf(board.phase);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1 style={{ marginBottom: 4 }}>{initialBoard.retro.name}</h1>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
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
            <button type="button" onClick={() => changePhase('next')}>
              Next phase
            </button>
          )}{' '}
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
        {board.columns
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((column) => {
            const cards = board.cards
              .filter((c) => c.columnId === column.id)
              .sort((a, b) => a.position.localeCompare(b.position));
            const canEdit = canEditColumn(column.kind);
            return (
              <section
                key={column.id}
                style={{ width: 260, flexShrink: 0, borderTop: `4px solid ${column.color}`, background: '#fafafa', borderRadius: 8, padding: 8 }}
              >
                <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>
                  {column.title} <span style={{ fontWeight: 'normal', color: '#666' }}>({cards.length})</span>
                </h2>
                {column.prompt && <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>{column.prompt}</p>}
                {cards.map((card) =>
                  card.hidden ? (
                    <HiddenCardPlaceholder key={card.id} columnColor={column.color} />
                  ) : (
                    <CardView
                      key={card.id}
                      card={card}
                      canEdit={canEdit && card.authorId === userId}
                      onEdit={(body) => editCard(card.id, body)}
                      onDelete={() => deleteCard(card.id)}
                    />
                  ),
                )}
                {canEdit && <AddCardForm onAdd={(body) => addCard(column.id, body)} />}
              </section>
            );
          })}
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
