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

  /** Call for every event received over Realtime. Applies immediately if it's the next expected
   * seq; otherwise buffers it until the gap closes (RN-008: "events arriving out of order are
   * buffered and applied strictly in seq order"). Safe to call with a stale replay — anything at
   * or below `lastAppliedSeq` is ignored. */
  applyServerEvent: (event: RetroEvent) => void;

  /** Optimistically applies `optimisticReduce` to the board immediately, then calls `send()`.
   * On rejection (a non-ok response or a thrown error), rolls back to the board as it was right
   * before this call and sets `lastError` (RN-008: "roll back and toast on rejection" — the
   * message itself, surfaced as `lastError`, is what a real toast would render). On success,
   * the board is deliberately left as-is here: the authoritative confirmation arrives through
   * `applyServerEvent` via the same broadcast every other client gets, not a second local path. */
  sendMutation: (args: { optimisticReduce: (board: TBoard) => TBoard; send: () => Promise<Response> }) => Promise<void>;

  /** Applies `patch` to the board immediately, without touching `lastAppliedSeq` (RN-011). For
   * state that arrives outside the retro's main seq-ordered event stream — e.g. the author's own
   * private `user:{id}` channel, which patches in a hidden card's real text alongside (not
   * instead of) the redacted version everyone gets on the shared channel at the same seq. Two
   * broadcasts of the same seq would otherwise collide in `applyServerEvent`'s seq gate. */
  applyLocalPatch: (patch: (board: TBoard) => TBoard) => void;

  /** Replaces the board and seq wholesale, discarding any buffered out-of-order events (RN-011:
   * used when the client refetches after a phase transition it can't otherwise resync from — see
   * BoardPage.tsx). A general "hard resync" primitive; this file still has no opinion on what a
   * board contains. */
  resetBoard: (board: TBoard, seq: number) => void;

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

export function createRetroStore<TBoard>(
  options: CreateRetroStoreOptions<TBoard>,
): UseBoundStore<StoreApi<RetroStoreState<TBoard>>> {
  const { initialBoard, initialSeq = 0, reduce } = options;
  const buffered = new Map<number, RetroEvent>();

  return create<RetroStoreState<TBoard>>((set, get) => ({
    board: initialBoard,
    lastAppliedSeq: initialSeq,
    lastError: null,

    applyServerEvent: (event) => {
      const { lastAppliedSeq } = get();
      if (event.seq <= lastAppliedSeq) return; // already applied, or a stale replay

      if (event.seq !== lastAppliedSeq + 1) {
        buffered.set(event.seq, event);
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
    },

    sendMutation: async ({ optimisticReduce, send }) => {
      const boardBeforeMutation = get().board;
      set({ board: optimisticReduce(boardBeforeMutation), lastError: null });

      // Round-trip telemetry (RN-008: "measure round trip in the browser and log it to the
      // console for now" — a real telemetry sink is RN-050).
      const startedAt = performance.now();
      try {
        const res = await send();
        console.log(`[mutation] round trip ${(performance.now() - startedAt).toFixed(0)}ms (status ${res.status})`);
        if (!res.ok) {
          const message = await res
            .json()
            .then((body: { message?: string; error?: string }) => body.message ?? body.error)
            .catch(() => undefined);
          set({ board: boardBeforeMutation, lastError: message ?? `Mutation failed (${res.status}).` });
        }
      } catch {
        set({ board: boardBeforeMutation, lastError: 'Network error — please try again.' });
      }
    },

    applyLocalPatch: (patch) => set((state) => ({ board: patch(state.board) })),

    resetBoard: (board, seq) => {
      buffered.clear();
      set({ board, lastAppliedSeq: seq, lastError: null });
    },

    clearError: () => set({ lastError: null }),
  }));
}
