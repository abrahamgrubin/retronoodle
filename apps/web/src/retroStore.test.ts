import { describe, expect, it } from 'vitest';
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
});

describe('retroStore — sendMutation', () => {
  it('applies optimistically and leaves the board as-is on success', async () => {
    const store = makeStore();
    await store.getState().sendMutation({
      optimisticReduce: (board) => [...board, 'optimistic:x'],
      send: async () => new Response(JSON.stringify({ seq: 1 }), { status: 200 }),
    });
    expect(store.getState().board).toEqual(['optimistic:x']);
    expect(store.getState().lastError).toBeNull();
  });

  it('rolls back and sets lastError from the response body on rejection', async () => {
    const store = makeStore();
    await store.getState().sendMutation({
      optimisticReduce: (board) => [...board, 'optimistic:x'],
      send: async () => new Response(JSON.stringify({ error: 'forbidden', message: 'Not allowed' }), { status: 403 }),
    });
    expect(store.getState().board).toEqual([]);
    expect(store.getState().lastError).toBe('Not allowed');
  });

  it('rolls back and sets a generic lastError when the request itself throws', async () => {
    const store = makeStore();
    await store.getState().sendMutation({
      optimisticReduce: (board) => [...board, 'optimistic:x'],
      send: async () => {
        throw new Error('network down');
      },
    });
    expect(store.getState().board).toEqual([]);
    expect(store.getState().lastError).toBe('Network error — please try again.');
  });

  it('only rolls back to the board as it was before this specific mutation', async () => {
    const store = makeStore();
    store.getState().applyServerEvent(event(1, 'confirmed'));

    await store.getState().sendMutation({
      optimisticReduce: (board) => [...board, 'optimistic:x'],
      send: async () => new Response('{}', { status: 500 }),
    });

    expect(store.getState().board).toEqual(['test.append:confirmed']);
  });

  it('clearError resets lastError', async () => {
    const store = makeStore();
    await store.getState().sendMutation({
      optimisticReduce: (board) => board,
      send: async () => new Response('{}', { status: 500 }),
    });
    expect(store.getState().lastError).not.toBeNull();
    store.getState().clearError();
    expect(store.getState().lastError).toBeNull();
  });
});
