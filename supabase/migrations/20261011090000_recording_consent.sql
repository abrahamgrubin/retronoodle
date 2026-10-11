-- RN-032: all-party recording consent and indicators.

-- "Online" tracking is new infrastructure this story needs: nothing before this ever recorded
-- who's *currently* connected to a retro (retro_participants is an insert-only historical
-- ledger — joined_at is set once and never touched again). A heartbeat ping from the client
-- (every ~10-15s while the board is mounted, apps/api/src/routes/board.ts) keeps this fresh;
-- "online" is defined as last_seen_at within the last 30s (board.ts's own ONLINE_WINDOW_SECONDS).
alter table public.retro_participants
  add column last_seen_at timestamptz not null default now();

-- One team setting: "Admin setting for facilitator-only confirmation, off by default" — when
-- true, recording.start skips asking every participant and starts immediately once the
-- facilitator confirms; the all-party consent flow below is the default (false).
alter table public.teams
  add column recording_facilitator_only_confirmation boolean not null default false;

-- One row per "Record" click. `facilitator_confirmed_at` is the facilitator's own confirmation
-- ("I've told everyone outside the app") — logged here, separately from any participant's
-- consent, per this story's own AC ("every agreement and the facilitator confirmation are
-- logged with time"). Only one non-stopped session per retro at a time (partial unique index
-- below) — starting a new recording after a previous one stopped is a brand-new row, not a
-- reopened one.
create table public.recording_sessions (
  id uuid primary key,
  retro_id uuid not null references public.retros (id) on delete cascade,
  started_by uuid not null references public.profiles (id),
  facilitator_confirmed_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'recording', 'paused', 'stopped')),
  started_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index recording_sessions_one_active_per_retro
  on public.recording_sessions (retro_id)
  where status <> 'stopped';

-- One row per participant whose agreement a session needs — seeded at recording.start from
-- whoever's online then (the facilitator's own row starts 'agreed', since starting + confirming
-- already is their agreement), and again by board.ts's heartbeat handler for anyone who connects
-- *after* a session already exists ("a late joiner pauses recording until they agree").
create table public.recording_consents (
  session_id uuid not null references public.recording_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  outcome text not null default 'pending' check (outcome in ('pending', 'agreed', 'declined')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index recording_consents_session_id_idx on public.recording_consents (session_id);

alter table public.recording_sessions enable row level security;
alter table public.recording_consents enable row level security;
