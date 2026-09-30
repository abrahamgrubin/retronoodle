import { describe, expect, it } from 'vitest';
import { computeClockOffsetMs, formatCountdown, remainingMs } from './clock';

describe('clock offset — RN-012', () => {
  it('two browsers with clocks 5s apart compute the exact same remaining time', () => {
    const serverTime = '2026-01-01T00:00:00.000Z';
    const deadline = '2026-01-01T00:05:00.000Z'; // 5 minutes out

    const browserANow = Date.parse('2026-01-01T00:00:00.000Z'); // in sync with the server
    const browserBNow = browserANow + 5000; // 5s ahead

    const offsetA = computeClockOffsetMs(serverTime, browserANow);
    const offsetB = computeClockOffsetMs(serverTime, browserBNow);

    // Both check 2s of real elapsed time later, each using its own (skewed) clock.
    const remainingA = remainingMs(deadline, offsetA, browserANow + 2000);
    const remainingB = remainingMs(deadline, offsetB, browserBNow + 2000);

    expect(remainingA).toBe(remainingB);
    expect(Math.abs(remainingA! - remainingB!)).toBeLessThanOrEqual(1000);
  });

  it('a deadline in the past yields a negative remaining time, not a clamped zero', () => {
    const offset = computeClockOffsetMs('2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:00:00.000Z'));
    const remaining = remainingMs('2026-01-01T00:00:00.000Z', offset, Date.parse('2026-01-01T00:00:05.000Z'));
    expect(remaining).toBe(-5000);
  });

  it('a null deadline (no timer for this phase) yields null', () => {
    expect(remainingMs(null, 0)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('formats m:ss with zero-padded seconds', () => {
    expect(formatCountdown(5 * 60 * 1000)).toBe('5:00');
    expect(formatCountdown(90 * 1000)).toBe('1:30');
    expect(formatCountdown(5 * 1000)).toBe('0:05');
  });

  it('clamps negative (expired) durations to 0:00', () => {
    expect(formatCountdown(-5000)).toBe('0:00');
  });
});
