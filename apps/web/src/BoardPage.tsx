import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { uuidv7 } from 'uuidv7';
import type { BoardCard, BoardResponse } from '@retronoodle/shared';
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

function CardView({
  card,
  isOwn,
  onEdit,
  onDelete,
}: {
  card: BoardCard;
  isOwn: boolean;
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
      {isOwn && (
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
      initialBoard: { columns: initialBoard.columns, cards: initialBoard.cards },
      initialSeq: initialBoard.seq,
      reduce: reduceBoard,
    }),
  );
  const { board, lastError, applyServerEvent, sendMutation, clearError } = useBoardStore();

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client.channel(`retro:${retroId}`, { config: { private: true } });
    channel.on('broadcast', { event: '*' }, (message) => {
      const { seq, result } = message.payload as { seq: number; result: unknown };
      applyServerEvent({ seq, type: message.event, payload: result });
    });
    channel.subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [retroId, applyServerEvent]);

  function addCard(columnId: string, body: string) {
    const cardId = uuidv7();
    const now = new Date().toISOString();
    void sendMutation({
      optimisticReduce: (b) =>
        reduceBoard(b, {
          seq: -1,
          type: 'card.create',
          payload: { id: cardId, columnId, authorId: userId, authorName: 'You', body, position: '', createdAt: now, updatedAt: now },
        }),
      send: () =>
        postMutation(accessToken, retroId, { mutationId: uuidv7(), type: 'card.create', payload: { cardId, columnId, body } }),
    });
  }

  function editCard(cardId: string, body: string) {
    void sendMutation({
      optimisticReduce: (b) => reduceBoard(b, { seq: -1, type: 'card.edit', payload: { id: cardId, body } }),
      send: () => postMutation(accessToken, retroId, { mutationId: uuidv7(), type: 'card.edit', payload: { cardId, body } }),
    });
  }

  function deleteCard(cardId: string) {
    void sendMutation({
      optimisticReduce: (b) => reduceBoard(b, { seq: -1, type: 'card.delete', payload: { id: cardId } }),
      send: () => postMutation(accessToken, retroId, { mutationId: uuidv7(), type: 'card.delete', payload: { cardId } }),
    });
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1 style={{ marginBottom: 4 }}>{initialBoard.retro.name}</h1>
      <p style={{ margin: '0 0 16px', color: '#666' }}>Phase: {initialBoard.retro.phase}</p>
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
            return (
              <section
                key={column.id}
                style={{ width: 260, flexShrink: 0, borderTop: `4px solid ${column.color}`, background: '#fafafa', borderRadius: 8, padding: 8 }}
              >
                <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>
                  {column.title} <span style={{ fontWeight: 'normal', color: '#666' }}>({cards.length})</span>
                </h2>
                {column.prompt && <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>{column.prompt}</p>}
                {cards.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    isOwn={card.authorId === userId}
                    onEdit={(body) => editCard(card.id, body)}
                    onDelete={() => deleteCard(card.id)}
                  />
                ))}
                <AddCardForm onAdd={(body) => addCard(column.id, body)} />
              </section>
            );
          })}
      </div>
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
