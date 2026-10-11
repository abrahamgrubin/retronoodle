import { describe, expect, it, vi } from 'vitest';
import { chain } from '../testUtils/supabaseChain.js';
import { recordTranscriptionUsage } from './costTracking.js';

describe('recordTranscriptionUsage', () => {
  it('does nothing for zero or negative audio seconds', async () => {
    const from = vi.fn();
    await recordTranscriptionUsage({ from } as never, 'retro-1', 0);
    await recordTranscriptionUsage({ from } as never, 'retro-1', -5);
    expect(from).not.toHaveBeenCalled();
  });

  it('seeds a new row from zero on the first call', async () => {
    const upsertCalls: unknown[][] = [];
    const from = vi.fn((table: string) => {
      if (table === 'transcription_usage') {
        const c = chain({ data: null, error: null }, upsertCalls);
        return c;
      }
      throw new Error(`unexpected table ${table}`);
    });
    await recordTranscriptionUsage({ from } as never, 'retro-1', 10);
    const upsertCall = upsertCalls.find(([name]) => name === 'upsert');
    expect(upsertCall?.[1]).toMatchObject({ retro_id: 'retro-1', audio_seconds: 10 });
    expect((upsertCall?.[1] as { cost_usd: number }).cost_usd).toBeCloseTo(10 * (0.2 / (45 * 60)), 10);
  });

  it('adds to the existing running total rather than overwriting it', async () => {
    const upsertCalls: unknown[][] = [];
    const from = vi.fn((table: string) => {
      if (table === 'transcription_usage') return chain({ data: { audio_seconds: 100, cost_usd: 0.5 }, error: null }, upsertCalls);
      throw new Error(`unexpected table ${table}`);
    });
    await recordTranscriptionUsage({ from } as never, 'retro-1', 20);
    const upsertCall = upsertCalls.find(([name]) => name === 'upsert');
    expect((upsertCall?.[1] as { audio_seconds: number }).audio_seconds).toBe(120);
    expect((upsertCall?.[1] as { cost_usd: number }).cost_usd).toBeGreaterThan(0.5);
  });
});
