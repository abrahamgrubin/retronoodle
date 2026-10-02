import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface RetroEvent {
  seq: number;
  type: string;
  payload: unknown;
}

export interface RetroStoreState<TBoard> {
  board: TBoard;
  lastAppliedSeq: number;
  lastError: string | null;
  /** RN-013: true once a buffered out-of-order event has been waiting more than ~1s for the gap
   * to close — "a seq gap older than 1s" is connection trouble, not ordinary network jitter.
   * Reactive state rather than a callback so the consumer reacts to it from its own effect
   * (`useEffect(() => { if (hasStaleGap) resync(); }, [hasStaleGap])`) instead of this store
   * invoking arbitrary caller code from inside `applyServerEvent`. Cleared by `resetBoard` or
   * once the gap actually closes. */
  hasStaleGap: boolean;

  /** Call for every event received over Realtime. Applies immediately if it's the next expected
   * seq; otherwise buffers it until the gap closes (RN-008: "events arriving out of order are
   * buffered and applied strictly in seq order"). Safe to call with a stale replay — anything at
   * or below `lastAppliedSeq` is ignored. */
  applyServerEvent: (event: RetroEvent) => void;

  /**
   * Optimistically applies `optimisticReduce` to the board immediately, then calls `send()`.
   * `mutationId` is the same id the caller's `send()` closure puts in the envelope — kept here so
   * a genuine network failure (offline, not a real rejection) can be replayed later with the
   * exact same id, which is what makes the replay idempotent server-side (RN-013).
   *
   * On an HTTP rejection (a non-ok response), rolls back to the board as it was right before this
   * call and sets `lastError` (RN-008: "roll back and toast on rejection"). On a network failure
   * (the request never reached the server — `fetch` itself threw), the optimistic state is kept
   * instead of rolled back, and the mutation is remembered for `retryPendingMutations` — RN-013:
   * "typing in a card editor never blocks" and "a card typed while offline is saved once after
   * reconnect", not silently lost or bounced back to the user as an error.
   *
   * On success, the board is otherwise left as-is: the authoritative confirmation arrives through
   * `applyServerEvent` via the same broadcast every other client gets, not a second local path.
   */
  sendMutation: (args: {
    mutationId: string;
    optimisticReduce: (board: TBoard) => TBoard;
    send: () => Promise<Response>;
  }) => Promise<void>;

  /** Applies `patch` to the board immediately, without touching `lastAppliedSeq` (RN-011). For
   * state that arrives outside the retro's main seq-ordered event stream — e.g. the author's own
   * private `user:{id}` channel, which patches in a hidden card's real text alongside (not
   * instead of) the redacted version everyone gets on the shared channel at the same seq. Two
   * broadcasts of the same seq would otherwise collide in `applyServerEvent`'s seq gate. */
  applyLocalPatch: (patch: (board: TBoard) => TBoard) => void;

  /** Replaces the board and seq wholesale, discarding any buffered out-of-order events (RN-011:
   * used when the client refetches after a phase transition it can't otherwise resync from; also
   * RN-013's reconnect/stale-gap resync). Any mutations still awaiting `retryPendingMutations`
   * are re-applied on top of the fresh snapshot, so an offline edit doesn't visibly vanish for
   * the moment between refetch and replay. A general "hard resync" primitive; this file still has
   * no opinion on what a board contains. */
  resetBoard: (board: TBoard, seq: number) => void;

  /** RN-013: resends every mutation that's still pending after a `resetBoard` — same `mutationId`
   * each time, so a request that actually reached the server before the connection dropped (just
   * lost its response) is a no-op replay, not a duplicate. Call after `resetBoard` on reconnect. */
  retryPendingMutations: () => Promise<void>;

  clearError: () => void;
}

export interface CreateRetroStoreOptions<TBoard> {
  initialBoard: TBoard;
  /** The seq the initial board snapshot is current as of (RN-009's GET /retros/:id/board
   * returns this) — events at or below it are already reflected in `initialBoard` and must be
   * ignored, not buffered or re-applied. Defaults to 0 (an empty board with nothing applied yet). */
  initialSeq?: number;
  /** Folds one confirmed server event into the board. Supplied by the consumer (RN-009+ for the
   * real card/column shape) — this file has no opinion on what a "board" contains. */
  reduce: (board: TBoard, event: RetroEvent) => TBoard;
}

const STALE_GAP_MS = 1000;

export function createRetroStore<TBoard>(
  options: CreateRetroStoreOptions<TBoard>,
): UseBoundStore<StoreApi<RetroStoreState<TBoard>>> {
  const { initialBoard, initialSeq = 0, reduce } = options;
  const buffered = new Map<number, RetroEvent>();
  const pending = new Map<string, { optimisticReduce: (board: TBoard) => TBoard; send: () => Promise<Response> }>();
  let gapTimer: ReturnType<typeof setTimeout> | null = null;

  function clearGapTimer() {
    if (gapTimer !== null) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
  }

  return create<RetroStoreState<TBoard>>((set, get) => ({
    board: initialBoard,
    lastAppliedSeq: initialSeq,
    lastError: null,
    hasStaleGap: false,

    applyServerEvent: (event) => {
      const { lastAppliedSeq } = get();
      if (event.seq <= lastAppliedSeq) return; // already applied, or a stale replay

      if (event.seq !== lastAppliedSeq + 1) {
        const isNewGap = buffered.size === 0;
        buffered.set(event.seq, event);
        if (isNewGap) {
          clearGapTimer();
          gapTimer = setTimeout(() => {
            gapTimer = null;
            set({ hasStaleGap: true });
          }, STALE_GAP_MS);
        }
        return;
      }

      set((state) => ({ board: reduce(state.board, event), lastAppliedSeq: event.seq }));

      let next = event.seq + 1;
      while (buffered.has(next)) {
        const nextEvent = buffered.get(next)!;
        buffered.delete(next);
        set((state) => ({ board: reduce(state.board, nextEvent), lastAppliedSeq: next }));
        next += 1;
      }

      if (buffered.size === 0) {
        clearGapTimer();
        set({ hasStaleGap: false });
      }
    },

    sendMutation: async ({ mutationId, optimisticReduce, send }) => {
      const boardBeforeMutation = get().board;
      set({ board: optimisticReduce(boardBeforeMutation), lastError: null });
      pending.set(mutationId, { optimisticReduce, send });

      // Round-trip telemetry (RN-008: "measure round trip in the browser and log it to the
      // console for now" — a real telemetry sink is RN-050).
      const startedAt = performance.now();
      try {
        const res = await send();
        console.log(`[mutation] round trip ${(performance.now() - startedAt).toFixed(0)}ms (status ${res.status})`);
        pending.delete(mutationId);
        if (!res.ok) {
          const message = await res
            .json()
            .then((body: { message?: string; error?: string }) => body.message ?? body.error)
            .catch(() => undefined);
          set({ board: boardBeforeMutation, lastError: message ?? `Mutation failed (${res.status}).` });
        }
      } catch {
        // The request never reached the server — kept in `pending` (not rolled back, no
        // lastError) for retryPendingMutations to resend once reconnected (RN-013).
      }
    },

    applyLocalPatch: (patch) => set((state) => ({ board: patch(state.board) })),

    resetBoard: (board, seq) => {
      // Bug found live: two independent HTTP requests (the mutation's own POST and a resync's
      // GET /board, both triggered by the same optimistic phase change — see BoardPage.tsx's
      // write->group resync) race the database with no ordering guarantee between them. If the
      // GET's query executes before the POST's transaction commits but its *response* happens to
      // arrive back at the browser after the POST's already has (slower round trip, not a slower
      // read), this runs with a snapshot that's older than what's already been confirmed —
      // observed as a phase visibly reverting ~2s after a facilitator clicks Skip. `seq` only
      // ever moves forward for a given retro (it's the Postgres-assigned gapless sequence this
      // store also enforces via applyServerEvent's own "ignore anything at or below
      // lastAppliedSeq" rule) — so a resync offering an *older* seq than what's already applied
      // is, by definition, stale, and must be dropped rather than regressing the board.
      if (seq < get().lastAppliedSeq) return;
      buffered.clear();
      clearGapTimer();
      let resynced = board;
      for (const { optimisticReduce } of pending.values()) resynced = optimisticReduce(resynced);
      set({ board: resynced, lastAppliedSeq: seq, lastError: null, hasStaleGap: false });
    },

    retryPendingMutations: async () => {
      // Snapshot first: a retry's own success/failure handling mutates `pending`, which would
      // otherwise change size mid-iteration.
      const entries = [...pending.entries()];
      for (const [mutationId, { send }] of entries) {
        try {
          const res = await send();
          pending.delete(mutationId);
          if (!res.ok) {
            const message = await res
              .json()
              .then((body: { message?: string; error?: string }) => body.message ?? body.error)
              .catch(() => undefined);
            set({ lastError: message ?? `Mutation failed (${res.status}).` });
          }
        } catch {
          // Still offline — leave it pending for the next reconnect.
        }
      }
    },

    clearError: () => set({ lastError: null }),
  }));
}
