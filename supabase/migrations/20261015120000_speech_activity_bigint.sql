-- RN-035: `start_ms`/`end_ms` store absolute epoch milliseconds (speechDetection.ts's
-- toAbsoluteInterval: `performance.timeOrigin + performance.now() + clockOffsetMs`), a 13-digit
-- number — `integer` tops out around 2.1 billion, which epoch-ms overflows almost immediately
-- (any real wall-clock time, not an offset from a recent epoch). Every upload failed with
-- Postgres error 22003 ("value ... out of range for type integer") from the very first real
-- test (found live). `transcript_segments.start_ms`/`end_ms` don't have this problem — those are
-- relative to the start of that one stream (Deepgram's own `start`/`duration` in seconds), not
-- absolute epoch time, so they were never at risk and aren't touched here.
alter table public.speech_activity
  alter column start_ms type bigint,
  alter column end_ms type bigint;
