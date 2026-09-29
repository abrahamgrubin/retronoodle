import { describe, expect, it, vi } from 'vitest';
import { startProcess } from './process.js';

function deps() {
  return {
    startApi: vi.fn(async () => ({ stop: vi.fn(async () => {}) })),
    startWorker: vi.fn(async () => ({ stop: vi.fn(async () => {}) })),
  };
}

describe('startProcess', () => {
  it('ROLE=all starts the API and the worker in one process', async () => {
    const d = deps();
    const p = await startProcess('all', d);
    expect(d.startApi).toHaveBeenCalledOnce();
    expect(d.startWorker).toHaveBeenCalledOnce();
    expect(p.api).not.toBeNull();
    expect(p.worker).not.toBeNull();
  });

  it('ROLE=api starts no worker', async () => {
    const d = deps();
    const p = await startProcess('api', d);
    expect(d.startApi).toHaveBeenCalledOnce();
    expect(d.startWorker).not.toHaveBeenCalled();
    expect(p.worker).toBeNull();
  });

  it('ROLE=worker starts no API', async () => {
    const d = deps();
    const p = await startProcess('worker', d);
    expect(d.startApi).not.toHaveBeenCalled();
    expect(d.startWorker).toHaveBeenCalledOnce();
    expect(p.api).toBeNull();
  });

  it('stop() stops everything it started', async () => {
    const d = deps();
    const p = await startProcess('all', d);
    await p.stop();
    expect(p.api?.stop).toHaveBeenCalledOnce();
    expect(p.worker?.stop).toHaveBeenCalledOnce();
  });
});
