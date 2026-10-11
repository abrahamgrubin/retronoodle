import { describe, expect, it } from 'vitest';
import { hungarianAssign, scoreSpeakerOverlap, tagLineToTopic } from './transcription.js';

describe('tagLineToTopic', () => {
  it('tags a sentence spanning a topic change to the topic where it started (RN-034 AC)', () => {
    const topics = [
      { id: 'topic-a', startedAt: 0, endedAt: 10_000 },
      { id: 'topic-b', startedAt: 10_000, endedAt: null },
    ];
    // "Next topic" lands at 9,800ms; the sentence it's part of started at 9,500ms, before the
    // 10,000ms boundary, so the whole line stays with topic-a even though it finished after.
    expect(tagLineToTopic({ startMs: 9_500 }, topics)).toBe('topic-a');
    expect(tagLineToTopic({ startMs: 10_000 }, topics)).toBe('topic-b');
  });

  it('tags topic jumps and reorders correctly, independent of array order (RN-034 AC)', () => {
    // A revisited topic (topic-a) started again later than topic-b, and the array lists it
    // first even though its second start is chronologically after topic-b's start.
    const topics = [
      { id: 'topic-a', startedAt: 20_000, endedAt: null },
      { id: 'topic-b', startedAt: 5_000, endedAt: 15_000 },
    ];
    expect(tagLineToTopic({ startMs: 7_000 }, topics)).toBe('topic-b');
    expect(tagLineToTopic({ startMs: 20_500 }, topics)).toBe('topic-a');
    // Gap between topic-b ending and topic-a restarting: no topic covers it.
    expect(tagLineToTopic({ startMs: 17_000 }, topics)).toBeNull();
  });

  it('returns null for a line before any topic started, and skips topics not yet started', () => {
    const topics = [{ id: 'topic-a', startedAt: null, endedAt: null }];
    expect(tagLineToTopic({ startMs: 100 }, topics)).toBeNull();
  });
});

describe('scoreSpeakerOverlap', () => {
  it('scores a perfectly aligned voice and participant at 1', () => {
    const voice = [{ startMs: 0, endMs: 2000 }];
    const participant = [{ startMs: 0, endMs: 2000 }];
    expect(scoreSpeakerOverlap(voice, participant)).toBeCloseTo(1, 5);
  });

  it('recovers a strong match despite constant clock-skew delay (synthetic delay)', () => {
    const voice = [{ startMs: 1000, endMs: 3000 }];
    // The participant's VAD intervals run 300ms behind the diarized call audio — a perfect match
    // once the delay search's forward shift brings them back into alignment.
    const participant = [{ startMs: 700, endMs: 2700 }];
    expect(scoreSpeakerOverlap(voice, participant)).toBeCloseTo(1, 5);
  });

  it('scores a near-miss from a second participant lower than the true speaker (echo)', () => {
    // Two participants in the same room: the true speaker's mic captures the full turn; a
    // second participant's mic only picks up a faint, partial echo of it.
    const voice = [{ startMs: 0, endMs: 4000 }];
    const trueSpeaker = [{ startMs: 0, endMs: 4000 }];
    const echoOnly = [{ startMs: 0, endMs: 800 }];
    const trueScore = scoreSpeakerOverlap(voice, trueSpeaker);
    const echoScore = scoreSpeakerOverlap(voice, echoOnly);
    expect(trueScore).toBeGreaterThanOrEqual(0.6);
    expect(echoScore).toBeLessThan(0.6);
    expect(echoScore).toBeLessThan(trueScore);
  });

  it('scores overlapping turns from multiple candidates by their own share of talk time', () => {
    const voice = [
      { startMs: 0, endMs: 1000 },
      { startMs: 2000, endMs: 3000 },
    ];
    // This candidate covers only the first turn.
    const partial = [{ startMs: 0, endMs: 1000 }];
    expect(scoreSpeakerOverlap(voice, partial)).toBeCloseTo(0.5, 5);
  });

  it('scores 0 for a voice with no recorded turns', () => {
    expect(scoreSpeakerOverlap([], [{ startMs: 0, endMs: 1000 }])).toBe(0);
  });
});

describe('hungarianAssign', () => {
  it('assigns each voice to its best-scoring, mutually exclusive candidate', () => {
    // voice 0 best matches candidate 1; voice 1 best matches candidate 0 — a greedy per-row pick
    // would double-book candidate 1, which the Hungarian algorithm's global optimum avoids.
    const scores = [
      [0.4, 0.9],
      [0.8, 0.5],
    ];
    expect(hungarianAssign(scores)).toEqual([1, 0]);
  });

  it('handles more voices than candidates by assigning each real voice to a distinct candidate', () => {
    const scores = [
      [0.9, 0.1],
      [0.8, 0.2],
      [0.1, 0.1],
    ];
    const assignment = hungarianAssign(scores);
    expect(assignment).toHaveLength(3);
    const real = assignment.filter((c): c is number => c !== null);
    expect(new Set(real).size).toBe(real.length);
  });

  it('returns an empty assignment for an empty matrix', () => {
    expect(hungarianAssign([])).toEqual([]);
  });
});
