-- RN-033/034/035/036: audio capture, topic tagging, on-device speech detection and speaker
-- matching. Builds on RN-031's transcript_segments (text is already ciphertext-only, RN-031's
-- own AC) and RN-032's recording_sessions/consents (gates whether the gateway accepts audio).

-- RN-033: server-authored rows (the audio gateway, never a browser mutation), so a server-side
-- default is appropriate here — unlike the browser-generated UUIDv7 ids CLAUDE.md requires for
-- user-created content.
alter table public.transcript_segments
  alter column id set default gen_random_uuid();

-- RN-034: which topic this line was said during (null until tagged, or if it falls in a gap no
-- topic covers). RN-036: which diarized voice said it (speaker_tag, the provider's own index)
-- and, once matched, which participant that voice belongs to (speaker_user_id) — kept even after
-- matching, since "Who is this?" regroups unmatched lines by speaker_tag within a topic.
alter table public.transcript_segments
  add column topic_id uuid references public.topics (id) on delete set null,
  add column speaker_tag integer,
  add column speaker_user_id uuid references public.profiles (id) on delete set null,
  add column start_ms integer not null default 0,
  add column end_ms integer not null default 0,
  -- RN-033: "facilitator tab drop records a gap and the next facilitator can resume" — a marker
  -- row with no text, written when the gateway socket closes unexpectedly.
  add column is_gap_marker boolean not null default false;

create index transcript_segments_topic_id_idx on public.transcript_segments (topic_id);

-- RN-035: on-device VAD speaking intervals, already clock-corrected client-side before upload —
-- never audio, only timestamps (the story's own AC). Consumed and deleted by RN-036's matching
-- job once a topic is scored ("Delete speech_activity after matching").
create table public.speech_activity (
  id uuid primary key default gen_random_uuid(),
  retro_id uuid not null references public.retros (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  start_ms integer not null,
  end_ms integer not null,
  created_at timestamptz not null default now()
);

create index speech_activity_retro_id_idx on public.speech_activity (retro_id);
create index speech_activity_topic_id_idx on public.speech_activity (topic_id);

-- RN-033 AC: "Cost per 45-minute retro is logged" — one row per retro, updated as the gateway
-- streams audio. Per-retro, not per-month like ai_usage: a retro, not a calendar month, is the
-- unit this cost is reported against.
create table public.transcription_usage (
  retro_id uuid primary key references public.retros (id) on delete cascade,
  audio_seconds numeric not null default 0,
  cost_usd numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.speech_activity enable row level security;
alter table public.transcription_usage enable row level security;
