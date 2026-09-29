import { describe, expect, it, vi } from 'vitest';
import { startWorker, type JobQueue } from './index.js';

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
});
