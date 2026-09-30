-- Retro phase state machine (Design 6.1). `phase_remaining_ms` is a P1 column (pause, RN-048)
-- included now so the mutation protocol doesn't change shape later.
create type public.retro_phase as enum (
  'setup', 'review', 'write', 'group', 'vote', 'discuss', 'wrap_up', 'closed'
);

create table public.retros (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  facilitator_id uuid not null references public.profiles (id),
  template_id uuid not null references public.templates (id),
  name text not null,
  phase public.retro_phase not null default 'setup',
  -- Only the hash is stored; the plaintext join code is never persisted (RN-006).
  join_code_hash text not null unique,
  cards_revealed boolean not null default false,
  vote_budget integer not null default 3 check (vote_budget > 0),
  phase_deadline timestamptz,
  phase_remaining_ms integer,
  next_retro_at date,
  is_demo boolean not null default false,
  closed_with_override boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index retros_team_id_idx on public.retros (team_id);
