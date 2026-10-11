import { z } from 'zod';

/** Model/pricing config lives here, never hard-coded at call sites (CLAUDE.md). Deepgram's
 * Nova-3 live-streaming list price — used only to estimate `transcription_usage.cost_usd` from
 * captured audio duration (never a billing source of truth); the story's own target is "about
 * $0.20" for a 45-minute retro, which is what this constant is reverse-engineered from. */
export const DEEPGRAM_MODEL = 'nova-3';
export const DEEPGRAM_USD_PER_AUDIO_SECOND = 0.2 / (45 * 60);

/** RN-033: "Stream only during Discuss and Wrap up" — the only phases the audio gateway accepts
 * a connection in, and the only phases the web client ever opens one. */
export const TRANSCRIPTION_CAPTURE_PHASES = ['discuss', 'wrap_up'] as const;

/** RN-036: auto-assign a diarized voice to a participant once its best-scoring match clears this
 * — below it, the segment's `speakerUserId` stays null and it surfaces in "Who is this?" instead. */
export const SPEAKER_MATCH_THRESHOLD = 0.6;

/** RN-036: "search call delay 0 to 1,000 ms in 50 ms steps" — VAD intervals (participant mics)
 * and diarized transcript turns (the call's mixed audio) are rarely in exact lockstep; this is
 * the clock-skew window the delay search compensates for. */
export const SPEAKER_MATCH_DELAY_SEARCH_MS = { minMs: 0, maxMs: 1000, stepMs: 50 } as const;

/**
 * One line from a TranscriptionProvider (RN-033) — `speakerTag` is the provider's own diarization
 * index (0, 1, 2, ...), not yet a real participant; RN-036 maps tags to users per topic.
 * Timestamps are milliseconds since the gateway's own stream started, not wall-clock.
 */
export const TranscriptLine = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  isFinal: z.boolean(),
  speakerTag: z.number().int().nullable(),
});
export type TranscriptLine = z.infer<typeof TranscriptLine>;

/**
 * A persisted, decrypted transcript line (RN-033/034/036). Plaintext once it leaves the server —
 * the DB row itself is what's encrypted (transcriptKeys.ts); the live broadcast and this response
 * shape both carry real text, same reasoning as the recording indicator itself: every listener on
 * `retro:{id}` already consented to this retro being recorded (RN-032).
 */
export const TranscriptSegment = z.object({
  id: z.string().uuid(),
  retroId: z.string().uuid(),
  topicId: z.string().uuid().nullable(),
  speakerTag: z.number().int().nullable(),
  speakerUserId: z.string().uuid().nullable(),
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  isGapMarker: z.boolean(),
  createdAt: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

/** RN-035: one on-device VAD-detected speaking interval, already clock-corrected (server-offset
 * applied client-side) before it's ever sent — the server never receives audio, only timestamps. */
export const SpeechActivityInterval = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type SpeechActivityInterval = z.infer<typeof SpeechActivityInterval>;

/** RN-036: a diarized voice in a topic whose best match scored below SPEAKER_MATCH_THRESHOLD —
 * "Who is this?" shows one of these per unmatched tag, with a short quote, so the facilitator can
 * fix it in one click. */
export const UnmatchedSpeaker = z.object({
  topicId: z.string().uuid(),
  speakerTag: z.number().int(),
  sampleText: z.string(),
  segmentIds: z.array(z.string().uuid()),
});
export type UnmatchedSpeaker = z.infer<typeof UnmatchedSpeaker>;

/**
 * RN-034: assigns a transcript line to the topic it started during — "a sentence finished after
 * 'Next topic' stays with the old topic" (the story's own example), so only `startMs` is checked,
 * never `endMs`. `topics` need not be in chronological order (a revisited topic's `startedAt`
 * moves forward in time without its position in the array changing) — every candidate is checked
 * independently rather than assuming the array is sorted. A topic still open (`endedAt: null`) is
 * treated as open-ended going forward. Returns null for a line before any topic started, or for a
 * gap no topic covers (e.g. one ended and the next hadn't started yet when it was said).
 */
export function tagLineToTopic(
  line: { startMs: number },
  topics: { id: string; startedAt: number | null; endedAt: number | null }[],
): string | null {
  for (const topic of topics) {
    if (topic.startedAt === null) continue;
    if (line.startMs < topic.startedAt) continue;
    if (topic.endedAt !== null && line.startMs >= topic.endedAt) continue;
    return topic.id;
  }
  return null;
}

export interface SpeechInterval {
  startMs: number;
  endMs: number;
}

/** Total overlapping duration (ms) between two interval sets, `b` shifted forward by `delayMs` —
 * the delay search tries a range of these to compensate for clock skew between the two sources
 * (RN-036: "search call delay 0 to 1,000 ms in 50 ms steps for max overlap"). Both lists are
 * assumed small (one topic's worth) and need not be sorted. */
function overlapMsAtDelay(a: SpeechInterval[], b: SpeechInterval[], delayMs: number): number {
  let total = 0;
  for (const ia of a) {
    for (const ib of b) {
      const shiftedStart = ib.startMs + delayMs;
      const shiftedEnd = ib.endMs + delayMs;
      const overlapStart = Math.max(ia.startMs, shiftedStart);
      const overlapEnd = Math.min(ia.endMs, shiftedEnd);
      if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
    }
  }
  return total;
}

function sumDurationMs(intervals: SpeechInterval[]): number {
  return intervals.reduce((total, i) => total + Math.max(0, i.endMs - i.startMs), 0);
}

/**
 * Best-delay overlap score between one diarized voice's turns and one participant's VAD
 * intervals — "score voice × person by overlap share" (RN-036). The share is of the voice's own
 * total talk time (not the union), so a participant whose mic caught extra silence/background
 * speech never dilutes a genuinely strong match. Tries every delay in
 * SPEAKER_MATCH_DELAY_SEARCH_MS and keeps the best.
 */
export function scoreSpeakerOverlap(voiceTurns: SpeechInterval[], participantIntervals: SpeechInterval[]): number {
  const voiceDurationMs = sumDurationMs(voiceTurns);
  if (voiceDurationMs === 0) return 0;
  const { minMs, maxMs, stepMs } = SPEAKER_MATCH_DELAY_SEARCH_MS;
  let best = 0;
  for (let delayMs = minMs; delayMs <= maxMs; delayMs += stepMs) {
    const overlap = overlapMsAtDelay(voiceTurns, participantIntervals, delayMs);
    if (overlap > best) best = overlap;
  }
  return Math.min(1, best / voiceDurationMs);
}

/**
 * Hungarian algorithm (Kuhn-Munkres), maximizing total score over a `rows x cols` score matrix —
 * RN-036's "Hungarian assignment" between diarized voices (rows) and candidate participants
 * (cols). Implemented via the standard trick of negating scores and solving as a minimum-cost
 * assignment on a square matrix (padded with zero-cost dummy rows/cols when rows.length !=
 * cols.length, so e.g. more voices than known participants still resolves every real voice to its
 * best available person). Returns, per row index, the assigned column index, or null if the row
 * was matched to a padding column (more rows than real columns). Any unmatched/padding score is
 * irrelevant to the caller anyway, since RN-036 only acts on scores that separately clear
 * SPEAKER_MATCH_THRESHOLD.
 */
export function hungarianAssign(scoreMatrix: number[][]): (number | null)[] {
  const rows = scoreMatrix.length;
  if (rows === 0) return [];
  const cols = Math.max(...scoreMatrix.map((row) => row.length));
  const n = Math.max(rows, cols);

  // Square cost matrix, 1-indexed (classic Hungarian implementations lean on a sentinel row/col
  // 0) — cost = -score so maximizing score becomes minimizing cost; padding cells cost 0.
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cost[r + 1]![c + 1] = -(scoreMatrix[r]?.[c] ?? 0);
    }
  }

  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0); // p[c] = row currently assigned to column c
  const way = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0]![j]! - u[i0]! - v[j]!;
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment: (number | null)[] = new Array(rows).fill(null);
  for (let j = 1; j <= n; j++) {
    const row = p[j]! - 1;
    const col = j - 1;
    if (row < rows && col < cols) assignment[row] = col;
  }
  return assignment;
}
