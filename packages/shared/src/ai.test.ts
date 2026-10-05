import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './ai.js';

describe('estimateCostUsd', () => {
  it('computes cost from per-million-token input/output pricing', () => {
    // claude-haiku-4-5-20251001: $1/M input, $5/M output.
    expect(estimateCostUsd('claude-haiku-4-5-20251001', 1_000_000, 0)).toBeCloseTo(1);
    expect(estimateCostUsd('claude-haiku-4-5-20251001', 0, 1_000_000)).toBeCloseTo(5);
    expect(estimateCostUsd('claude-haiku-4-5-20251001', 100_000, 20_000)).toBeCloseTo(0.1 + 0.1);
  });

  it('returns 0 for an unknown model rather than guessing', () => {
    expect(estimateCostUsd('some-future-model', 1_000_000, 1_000_000)).toBe(0);
  });
});
