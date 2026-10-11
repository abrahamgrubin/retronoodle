import { describe, expect, it, vi } from 'vitest';
import { runTranscriptRetentionJob } from './transcriptRetention.js';

const logger = { info: vi.fn(), error: vi.fn() };

/** supabase-js query builders are themselves "thenable" — `await supabase.from(x).select().eq()`
 * resolves without a terminal call like `.single()`. This fakes that: every chain method
 * (`select`/`eq`/`in`/`lt`/`delete`) returns the same object, and awaiting it at any point in the
 * chain resolves to the next queued response — one response per `.from(table)` call, in the
 * order `runTranscriptRetentionJob` actually makes them (teams select, retros select,
 * transcript_segments delete — repeated per retention tier that has any teams/retros to act on). */
function fakeSupabase(responses: { data: unknown[] | null; error?: unknown }[]) {
  let call = 0;
  const deleteFn = vi.fn();
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      lt: () => builder,
      delete: (...args: unknown[]) => {
        deleteFn(...args);
        return builder;
      },
      then: (resolve: (v: unknown) => void) => resolve(responses[call++] ?? { data: null }),
    };
    return builder;
  });
  return { from, deleteFn };
}

describe('runTranscriptRetentionJob', () => {
  it('does nothing when no team is at any retention tier', async () => {
    const supabaseAdmin = fakeSupabase([{ data: [] }, { data: [] }, { data: [] }]);
    await runTranscriptRetentionJob({ supabaseAdmin: supabaseAdmin as never, logger });
    expect(supabaseAdmin.deleteFn).not.toHaveBeenCalled();
  });

  it('does nothing for a tier with teams but no closed retros past the cutoff', async () => {
    const supabaseAdmin = fakeSupabase([
      { data: [{ id: 'team-1' }] }, // teams at 1-day retention
      { data: [] }, // no expired retros for that team
      { data: [] }, // 30-day tier: no teams
      { data: [] }, // 90-day tier: no teams
    ]);
    await runTranscriptRetentionJob({ supabaseAdmin: supabaseAdmin as never, logger });
    expect(supabaseAdmin.deleteFn).not.toHaveBeenCalled();
  });

  it("deletes transcript_segments for retros past their team's retention cutoff", async () => {
    const supabaseAdmin = fakeSupabase([
      { data: [{ id: 'team-1' }] }, // teams at 1-day retention
      { data: [{ id: 'retro-1' }, { id: 'retro-2' }] }, // their expired retros
      { data: [] }, // 30-day tier: no teams
      { data: [] }, // 90-day tier: no teams
    ]);
    await runTranscriptRetentionJob({ supabaseAdmin: supabaseAdmin as never, logger });
    expect(supabaseAdmin.deleteFn).toHaveBeenCalledTimes(1);
  });

  it('logs and continues past a query error on one tier instead of throwing', async () => {
    const supabaseAdmin = fakeSupabase([
      { data: null, error: new Error('boom') }, // 1-day tier: teams query fails
      { data: [] }, // 30-day tier
      { data: [] }, // 90-day tier
    ]);
    await expect(runTranscriptRetentionJob({ supabaseAdmin: supabaseAdmin as never, logger })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
    expect(supabaseAdmin.deleteFn).not.toHaveBeenCalled();
  });
});
