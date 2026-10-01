import { describe, expect, it, vi } from 'vitest';
import { AI_GROUP_CARDS_QUEUE, startWorker, type JobQueue } from './index.js';

function fakeQueue(): JobQueue & { started: boolean } {
  const q = {
    started: false,
    start: vi.fn(async () => {
      q.started = true;
    }),
    stop: vi.fn(async () => {
      q.started = false;
    }),
    on: vi.fn(),
    createQueue: vi.fn(async () => {}),
    work: vi.fn(async () => 'subscription-id'),
  };
  return q;
}

const logger = { info: vi.fn(), error: vi.fn() };

describe('startWorker', () => {
  it('starts the queue with the database URL', async () => {
    const queue = fakeQueue();
    const createQueue = vi.fn(() => queue);
    await startWorker({ databaseUrl: 'postgres://example', logger, createQueue });
    expect(createQueue).toHaveBeenCalledWith('postgres://example');
    expect(queue.started).toBe(true);
    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('stops gracefully', async () => {
    const queue = fakeQueue();
    const worker = await startWorker({ databaseUrl: 'x', logger, createQueue: () => queue });
    await worker.stop();
    expect(queue.stop).toHaveBeenCalledWith({ graceful: true });
    expect(queue.started).toBe(false);
  });

  it('registers the ai.groupCards handler only when `ai` deps are provided (RN-017)', async () => {
    const queue = fakeQueue();
    await startWorker({ databaseUrl: 'x', logger, createQueue: () => queue });
    expect(queue.createQueue).not.toHaveBeenCalled();
    expect(queue.work).not.toHaveBeenCalled();
  });

  it('registers ai.groupCards when `ai` deps are provided', async () => {
    const queue = fakeQueue();
    const ai = { supabaseAdmin: {} as never, realtimeBus: { broadcastUser: vi.fn() }, anthropicApiKey: undefined };
    await startWorker({ databaseUrl: 'x', logger, createQueue: () => queue, ai });
    expect(queue.createQueue).toHaveBeenCalledWith(AI_GROUP_CARDS_QUEUE);
    expect(queue.work).toHaveBeenCalledWith(AI_GROUP_CARDS_QUEUE, expect.any(Function));
  });
});
