import { describe, expect, it, vi } from 'vitest';
import type { TranscriptSegment } from '@retronoodle/shared';
import { buildTranscriptSegments, buildUnmatchedSpeakers } from './boardTranscript.js';

const topicA = '00000000-0000-4000-8000-000000000001';
const topicB = '00000000-0000-4000-8000-000000000002';
const userX = '00000000-0000-4000-8000-000000000010';

function segment(overrides: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    id: '00000000-0000-4000-8000-000000000099',
    retroId: '00000000-0000-4000-8000-000000000000',
    topicId: topicA,
    speakerTag: 0,
    speakerUserId: null,
    text: 'hello',
    startMs: 0,
    endMs: 1000,
    isGapMarker: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildUnmatchedSpeakers', () => {
  it('groups unmatched segments by topic and speaker tag', () => {
    const result = buildUnmatchedSpeakers([
      segment({ id: 'seg-1', topicId: topicA, speakerTag: 0 }),
      segment({ id: 'seg-2', topicId: topicA, speakerTag: 0, text: 'again' }),
      segment({ id: 'seg-3', topicId: topicA, speakerTag: 1 }),
      segment({ id: 'seg-4', topicId: topicB, speakerTag: 0 }),
    ]);
    expect(result).toHaveLength(3);
    const topicAVoice0 = result.find((r) => r.topicId === topicA && r.speakerTag === 0);
    expect(topicAVoice0?.segmentIds).toEqual(['seg-1', 'seg-2']);
  });

  it('excludes segments already matched to a user', () => {
    const result = buildUnmatchedSpeakers([segment({ speakerUserId: userX })]);
    expect(result).toEqual([]);
  });

  it('excludes gap markers and untagged lines', () => {
    const result = buildUnmatchedSpeakers([segment({ isGapMarker: true }), segment({ topicId: null }), segment({ speakerTag: null })]);
    expect(result).toEqual([]);
  });
});

describe('buildTranscriptSegments', () => {
  it('returns an empty list without querying when no master key is configured', async () => {
    const from = vi.fn();
    const result = await buildTranscriptSegments({ from } as never, undefined, 'retro-1', 'team-1');
    expect(result).toEqual({ segments: [], error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates a query error without throwing', async () => {
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: null, error: new Error('boom') }) }) }),
    }));
    const masterKey = Buffer.alloc(32, 1).toString('base64');
    const result = await buildTranscriptSegments({ from } as never, masterKey, 'retro-1', 'team-1');
    expect(result.segments).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });
});
