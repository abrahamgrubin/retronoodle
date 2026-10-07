-- RN-031: per-team transcript encryption and retention. Every binary value (wrapped data key,
-- ciphertext, IV, auth tag) is stored as base64 `text`, same convention as join_code_hash (hex
-- `text`, not a native `bytea` column) — avoids PostgREST's bytea wire-format entirely.
alter table public.teams
  add column transcript_retention_days integer not null default 1 check (transcript_retention_days in (1, 30, 90));

-- One AES-256-GCM data key per team, wrapped by the app's master key (Render env secret now, AWS
-- KMS in production — Design 10.1). The master key itself is never stored; only ever used in
-- memory to wrap/unwrap this one small per-team key. Deleting a team's row here is how "destroy
-- this team's key" works (RN-031 AC: "Destroying a team key makes its transcripts unreadable") —
-- crypto-shredding, not touching transcript_segments at all.
create table public.team_transcript_keys (
  team_id uuid primary key references public.teams (id) on delete cascade,
  wrapped_key text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now()
);

-- Transcript text is the one thing in this table that's actually encrypted — `ciphertext` is
-- never plaintext (RN-031 AC: "A raw DB read of transcript_segments.text shows ciphertext
-- only"). Rows are written by RN-033's audio gateway, not yet built; this story only needs the
-- table to exist so encryption/retention can be built and tested against it now.
create table public.transcript_segments (
  id uuid primary key,
  retro_id uuid not null references public.retros (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now()
);

create index transcript_segments_retro_id_idx on public.transcript_segments (retro_id);

alter table public.team_transcript_keys enable row level security;
alter table public.transcript_segments enable row level security;
