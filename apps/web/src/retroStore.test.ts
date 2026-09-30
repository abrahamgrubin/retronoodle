import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRetroStore, type RetroEvent } from './retroStore';

// A trivial board (array of strings) and reducer (push the payload) — this file has no opinion
// on what a real board looks like (that's RN-009+); these tests only prove the generic
// sequencing/optimistic-apply machinery.
function makeStore() {
  return createRetroStore<string[]>({
    initialBoard: [],
    reduce: (board, event) => [...board, `${event.type}:${event.payload}`],
  });
}

function event(seq: number, payload: string): RetroEvent {
  return { seq, type: 'test.append', payload };
}

describe('retroStore — applyServerEvent', () => {
  it('applies events immediately when they arrive in order', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(2, 'b'));
    expect(store.getState().board).toEqual(['test.append:a', 'test.append:b']);
    expect(store.getState().lastAppliedSeq).toBe(2);
  });

  it('buffers an out-of-order event and applies it once the gap closes', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(3, 'c')); // arrives early — seq 2 hasn't shown up yet
    expect(store.getState().board).toEqual(['test.append:a']);
    expect(store.getState().lastAppliedSeq).toBe(1);

    store.getState().applyServerEvent(event(2, 'b')); // closes the gap — 2 then buffered 3 apply
    expect(store.getState().board).toEqual(['test.append:a', 'test.append:b', 'test.append:c']);
    expect(store.getState().lastAppliedSeq).toBe(3);
  });

  it('drains multiple buffered events in seq order once the gap closes', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(4, 'd'));
    store.getState().applyServerEvent(event(3, 'c'));
    store.getState().applyServerEvent(event(2, 'b'));
    expect(store.getState().board).toEqual(['test.append:a', 'test.append:b', 'test.append:c', 'test.append:d']);
    expect(store.getState().lastAppliedSeq).toBe(4);
  });

  it('ignores a stale replay at or below the last applied seq', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(1, 'a-again'));
    expect(store.getState().board).toEqual(['test.append:a']);
    expect(store.getState().lastAppliedSeq).toBe(1);
  });

  it('starts from a given initialSeq (RN-009: a board snapshot already reflects everything up to its own seq)', () => {
    const store = createRetroStore<string[]>({
      initialBoard: ['snapshot:preloaded'],
      initialSeq: 5,
      reduce: (board, e) => [...board, `${e.type}:${e.payload}`],
    });

    store.getState().applyServerEvent(event(5, 'already-in-snapshot'));
    expect(store.getState().board).toEqual(['snapshot:preloaded']); // ignored, not re-applied

    store.getState().applyServerEvent(event(6, 'new'));
    expect(store.getState().board).toEqual(['snapshot:preloaded', 'test.append:new']);
    expect(store.getState().lastAppliedSeq).toBe(6);
  });
});

describe('retroStore — stale gap detection (RN-013)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sets hasStaleGap once a buffered gap has waited ~1s without closing', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(3, 'c')); // seq 2 missing

    vi.advanceTimersByTime(999);
    expect(store.getState().hasStaleGap).toBe(false);
    vi.advanceTimersByTime(2);
    expect(store.getState().hasStaleGap).toBe(true);
  });

  it('never sets hasStaleGap if the gap closes before 1s', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(3, 'c'));
    vi.advanceTimersByTime(500);
    store.getState().applyServerEvent(event(2, 'b')); // closes the gap in time

    vi.advanceTimersByTime(1000);
    expect(store.getState().hasStaleGap).toBe(false);
  });

  it('a later gap (after resetBoard) gets its own fresh timer', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(3, 'c'));
    store.getState().resetBoard(['fresh'], 10); // clears the pending timer and hasStaleGap

    store.getState().applyServerEvent(event(12, 'e')); // seq 11 missing
    vi.advanceTimersByTime(999);
    expect(store.getState().hasStaleGap).toBe(false); // the old timer didn't leak through
    vi.advanceTimersByTime(2);
    expect(store.getState().hasStaleGap).toBe(true); // the new gap's own timer fired
  });

  it('clears hasStaleGap once the gap finally closes on its own, not just via resetBoard', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(3, 'c'));
    vi.advanceTimersByTime(1000);
    expect(store.getState().hasStaleGap).toBe(true);

    store.getState().applyServerEvent(event(2, 'b')); // the missing event finally arrives
    expect(store.getState().hasStaleGap).toBe(false);
  });
});

describe('retroStore — sendMutation', () => {
  it('applies optimistically and leaves the board as-is on success', async () => {
    const store = makeStore();
    await store.getState().sendMutation({
      mutationId: 'm1',
      optimisticReduce: (board) => [...board, 'optimistic:x'],
      send: async () => new Response(JSON.stringify({ seq: 1 }), { status: 200 }),
    });
    expect(store.getState().board).toEqual(['optimistic:x']);
    expect(store.getState().lastError).toBeNull();
  });

  it('rolls back and sets lastError from the response body on rejection', async () => {
    const store = makeStore();
    await store.getState().sendMutation({
      mutationId: 'm1',
      optimisticReduce: (board) => [...board, 'optimistic:x'],
      send: async () => new Response(JSON.stringify({ error: 'forbidden', message: 'Not allowed' }), { status: 403 }),
    });
    expect(store.getState().board).toEqual([]);
    expect(store.getState().lastError).toBe('Not allowed');
  });

  it('RN-013: a network failure (fetch itself throws) keeps the optimistic state instead of rolling back', async () => {
    const store = makeStore();
    await store.getState().sendMutation({
      mutationId: 'm1',
      optimisticReduce: (board) => [...board, 'optimistic:x'],
      send: async () => {
        throw new Error('offline');
      },
    });
    // Kept, not rolled back — "typing in a card editor never blocks" and the edit isn't lost.
    expect(store.getState().board).toEqual(['optimistic:x']);
    expect(store.getState().lastError).toBeNull();
  });

  it('only rolls back to the board as it was before this specific mutation', async () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'confirmed'));

    await store.getState().sendMutation({
      mutationId: 'm1',
      optimisticReduce: (board) => [...board, 'optimistic:x'],
      send: async () => new Response('{}', { status: 500 }),
    });

    expect(store.getState().board).toEqual(['test.append:confirmed']);
  });

  it('clearError resets lastError', async () => {
    const store = makeStore();
    await store.getState().sendMutation({ mutationId: 'm1', optimisticReduce: (b) => b, send: async () => new Response('{}', { status: 500 }) });
    expect(store.getState().lastError).not.toBeNull();
    store.getState().clearError();
    expect(store.getState().lastError).toBeNull();
  });
});

describe('retroStore — applyLocalPatch (RN-011)', () => {
  it('applies the patch immediately without touching lastAppliedSeq', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyLocalPatch((board) => [...board, 'patched']);
    expect(store.getState().board).toEqual(['test.append:a', 'patched']);
    expect(store.getState().lastAppliedSeq).toBe(1); // unchanged — not part of the seq stream

    // A same-seq server event afterward still applies normally — the patch never consumed a seq.
    store.getState().applyServerEvent(event(2, 'b'));
    expect(store.getState().board).toEqual(['test.append:a', 'patched', 'test.append:b']);
  });
});

describe('retroStore — resetBoard (RN-011, extended by RN-013)', () => {
  it('replaces the board and seq, and drops any buffered out-of-order events', () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'a'));
    store.getState().applyServerEvent(event(5, 'buffered-and-orphaned')); // arrives early, buffered

    store.getState().resetBoard(['fresh snapshot'], 10);
    expect(store.getState().board).toEqual(['fresh snapshot']);
    expect(store.getState().lastAppliedSeq).toBe(10);

    // The event buffered before the reset must not resurrect once seq 5 becomes "next" again —
    // proving the buffer was actually cleared, not just skipped over.
    store.getState().applyServerEvent(event(11, 'c'));
    expect(store.getState().board).toEqual(['fresh snapshot', 'test.append:c']);
  });

  it('clears lastError too', async () => {
    const store = makeStore();
    await store
      .getState()
      .sendMutation({ mutationId: 'm1', optimisticReduce: (b) => b, send: async () => new Response('{}', { status: 500 }) });
    expect(store.getState().lastError).not.toBeNull();

    store.getState().resetBoard([], 0);
    expect(store.getState().lastError).toBeNull();
  });

  it('RN-013: re-applies a still-pending mutation on top of the fresh snapshot, so an offline edit stays visible', async () => {
    const store = makeStore();
    void store.getState().sendMutation({
      mutationId: 'm1',
      optimisticReduce: (board) => [...board, 'optimistic:offline-edit'],
      send: () => new Promise<Response>(() => {}), // never resolves — simulates "still offline"
    });
    await Promise.resolve(); // let sendMutation's synchronous optimistic-apply run

    store.getState().resetBoard(['fresh snapshot'], 10);
    expect(store.getState().board).toEqual(['fresh snapshot', 'optimistic:offline-edit']);
  });
});

describe('retroStore — retryPendingMutations (RN-013)', () => {
  it('resends a pending mutation with its original mutationId and clears it from pending on success', async () => {
    const store = makeStore();
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await store.getState().sendMutation({ mutationId: 'm1', optimisticReduce: (b) => [...b, 'x'], send });
    expect(send).toHaveBeenCalledTimes(1); // failed, stayed pending

    await store.getState().retryPendingMutations();
    expect(send).toHaveBeenCalledTimes(2); // resent

    // A second retry call has nothing left pending — send isn't called again.
    await store.getState().retryPendingMutations();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rolls back and sets lastError if the retried mutation comes back rejected', async () => {
    const store = makeStore();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Phase changed' }), { status: 409 }));

    await store.getState().sendMutation({ mutationId: 'm1', optimisticReduce: (b) => [...b, 'x'], send });
    await store.getState().retryPendingMutations();

    expect(store.getState().lastError).toBe('Phase changed');
  });

  it('leaves a mutation pending if the retry itself fails again (still offline)', async () => {
    const store = makeStore();
    const send = vi.fn().mockRejectedValue(new Error('still offline'));

    await store.getState().sendMutation({ mutationId: 'm1', optimisticReduce: (b) => [...b, 'x'], send });
    await store.getState().retryPendingMutations();
    expect(send).toHaveBeenCalledTimes(2);

    await store.getState().retryPendingMutations();
    expect(send).toHaveBeenCalledTimes(3); // still pending, tried again
  });
});
