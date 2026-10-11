import { describe, expect, it, vi } from 'vitest';
import { runMatchSpeakersJob } from './matchSpeakers.js';

const logger = { info: vi.fn(), error: vi.fn() };

/** Same "thenable query builder" fake as transcriptRetention.test.ts — every chain method just
 * records its call and returns the builder; `then` resolves the next queued response, one per
 * `.from(table)` call in the order runMatchSpeakersJob actually makes them (segments select,
 * activity select, then one update per assigned tag, then the activity delete). */
function fakeSupabase(responses: { data: unknown[] | null; error?: unknown }[]) {
  let call = 0;
  const updateFn = vi.fn();
  const deleteFn = vi.fn();
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      update: (...args: unknown[]) => {
        updateFn(...args);
        return builder;
      },
      delete: (...args: unknown[]) => {
        deleteFn(...args);
        return builder;
      },
      then: (resolve: (v: unknown) => void) => resolve(responses[call++] ?? { data: null }),
    };
    return builder;
  });
  return { from, updateFn, deleteFn };
}

describe('runMatchSpeakersJob', () => {
  it('does nothing when the topic has no diarized segments', async () => {
    const supabaseAdmin = fakeSupabase([{ data: [] }]);
    await runMatchSpeakersJob({ topicId: 'topic-1' }, { supabaseAdmin: supabaseAdmin as never, logger });
    expect(supabaseAdmin.updateFn).not.toHaveBeenCalled();
    expect(supabaseAdmin.deleteFn).not.toHaveBeenCalled();
  });

  it('assigns a clearly-matching voice and clears speech_activity for the topic', async () => {
    const supabaseAdmin = fakeSupabase([
      { data: [{ id: 'seg-1', retro_id: 'retro-1', speaker_tag: 0, start_ms: 0, end_ms: 2000 }] },
      { data: [{ id: 'act-1', user_id: 'user-a', start_ms: 0, end_ms: 2000 }] },
    ]);
    await runMatchSpeakersJob({ topicId: 'topic-1' }, { supabaseAdmin: supabaseAdmin as never, logger });
    expect(supabaseAdmin.updateFn).toHaveBeenCalledWith({ speaker_user_id: 'user-a' });
    expect(supabaseAdmin.deleteFn).toHaveBeenCalledTimes(1);
  });

  it('leaves a low-overlap voice unassigned but still clears speech_activity', async () => {
    const supabaseAdmin = fakeSupabase([
      { data: [{ id: 'seg-1', retro_id: 'retro-1', speaker_tag: 0, start_ms: 0, end_ms: 2000 }] },
      // Only 200ms of a 2000ms turn overlaps — well under SPEAKER_MATCH_THRESHOLD (0.6).
      { data: [{ id: 'act-1', user_id: 'user-a', start_ms: 0, end_ms: 200 }] },
    ]);
    await runMatchSpeakersJob({ topicId: 'topic-1' }, { supabaseAdmin: supabaseAdmin as never, logger });
    expect(supabaseAdmin.updateFn).not.toHaveBeenCalled();
    expect(supabaseAdmin.deleteFn).toHaveBeenCalledTimes(1);
  });

  it('clears speech_activity even when no activity rows exist for the topic', async () => {
    const supabaseAdmin = fakeSupabase([
      { data: [{ id: 'seg-1', retro_id: 'retro-1', speaker_tag: 0, start_ms: 0, end_ms: 2000 }] },
      { data: [] },
    ]);
    await runMatchSpeakersJob({ topicId: 'topic-1' }, { supabaseAdmin: supabaseAdmin as never, logger });
    expect(supabaseAdmin.updateFn).not.toHaveBeenCalled();
    expect(supabaseAdmin.deleteFn).toHaveBeenCalledTimes(1);
  });
});
