import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

describe('readConfig', () => {
  it('parses AI_MONTHLY_CAP_USD as a number', () => {
    expect(readConfig({ AI_MONTHLY_CAP_USD: '5' }).aiMonthlyCapUsd).toBe(5);
    expect(readConfig({ AI_MONTHLY_CAP_USD: '2.5' }).aiMonthlyCapUsd).toBe(2.5);
  });

  it('is undefined when AI_MONTHLY_CAP_USD is unset — no cap enforced', () => {
    expect(readConfig({}).aiMonthlyCapUsd).toBeUndefined();
  });
});
