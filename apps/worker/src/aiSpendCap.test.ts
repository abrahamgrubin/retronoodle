import { describe, expect, it, vi } from 'vitest';
import { isOverMonthlyCap, recordAiUsage } from './aiSpendCap.js';

function fakeSupabase(existing: { total_cost_usd: string } | null) {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing });
  return {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert,
    })),
    upsert,
    maybeSingle,
  };
}

describe('isOverMonthlyCap', () => {
  it('is false when nothing has been spent yet this month', async () => {
    const supabaseAdmin = fakeSupabase(null);
    await expect(isOverMonthlyCap(supabaseAdmin as never, 5)).resolves.toBe(false);
  });

  it('is false when under the cap, true at or over it', async () => {
    const under = fakeSupabase({ total_cost_usd: '4.9999' });
    await expect(isOverMonthlyCap(under as never, 5)).resolves.toBe(false);

    const atCap = fakeSupabase({ total_cost_usd: '5.0000' });
    await expect(isOverMonthlyCap(atCap as never, 5)).resolves.toBe(true);

    const over = fakeSupabase({ total_cost_usd: '5.5' });
    await expect(isOverMonthlyCap(over as never, 5)).resolves.toBe(true);
  });
});

describe('recordAiUsage', () => {
  it('does nothing for an unknown model (estimates to $0) — no upsert call at all', async () => {
    const supabaseAdmin = fakeSupabase(null);
    await recordAiUsage(supabaseAdmin as never, 'some-unknown-model', 1000, 1000);
    expect(supabaseAdmin.upsert).not.toHaveBeenCalled();
  });

  it('adds this call\'s estimated cost onto whatever was already recorded this month', async () => {
    const supabaseAdmin = fakeSupabase({ total_cost_usd: '1.0000' });
    // claude-haiku-4-5-20251001: $1/M input, $5/M output — 100k in + 20k out = $0.1 + $0.1 = $0.2.
    await recordAiUsage(supabaseAdmin as never, 'claude-haiku-4-5-20251001', 100_000, 20_000);
    expect(supabaseAdmin.upsert).toHaveBeenCalledWith(expect.objectContaining({ total_cost_usd: 1.2 }));
  });

  it('starts from $0 when nothing was recorded yet this month', async () => {
    const supabaseAdmin = fakeSupabase(null);
    await recordAiUsage(supabaseAdmin as never, 'claude-haiku-4-5-20251001', 1_000_000, 0);
    expect(supabaseAdmin.upsert).toHaveBeenCalledWith(expect.objectContaining({ total_cost_usd: 1 }));
  });
});
