import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { uuidv7 } from 'uuidv7';
import {
  allowedActions,
  footerHint,
  nextPhase,
  phaseDurationMinutes,
  phaseSubtitle,
  previousPhase,
  type BoardResponse,
  type RetroPhase,
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
