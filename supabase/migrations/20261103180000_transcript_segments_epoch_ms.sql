-- RN-036 speaker matching never matched anything: transcript_segments.start_ms/end_ms were
-- Deepgram's offsets from the start of one gateway stream (a few seconds to minutes), while
-- speech_activity.start_ms/end_ms are absolute epoch milliseconds (20261015120000). The worker's
-- matchSpeakers job overlaps the two directly, so every score was zero and every voice ended up
-- in "Who is this?" (found live). The gateway now stores segments as epoch milliseconds too
-- (audioGateway.ts adds its stream start to Deepgram's offsets), which needs the same widening
-- speech_activity already got — 13-digit epoch values overflow `integer`.
--
-- Existing rows keep their old relative values: nothing reads them as times (the board orders
-- by start_ms and shows created_at; speaker matching only runs once, as each topic ends), so
-- there is nothing to backfill.
alter table public.transcript_segments
  alter column start_ms type bigint,
  alter column end_ms type bigint;
