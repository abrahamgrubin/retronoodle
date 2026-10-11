import { describe, expect, it } from 'vitest';
import { toAbsoluteInterval } from './speechDetection';

describe('toAbsoluteInterval', () => {
  it('adds the clock offset to both endpoints', () => {
    expect(toAbsoluteInterval(1000, 2500, 300)).toEqual({ startMs: 1300, endMs: 2800 });
  });

  it('handles a negative offset (local clock ahead of the server)', () => {
    expect(toAbsoluteInterval(1000, 2500, -200)).toEqual({ startMs: 800, endMs: 2300 });
  });

  it('rounds to the nearest millisecond', () => {
    expect(toAbsoluteInterval(1000.4, 2000.6, 0.3)).toEqual({ startMs: 1001, endMs: 2001 });
  });
});
