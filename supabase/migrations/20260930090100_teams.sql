-- Teams and membership. Roles per Design 3.4: Admin, Member.
create type public.team_role as enum ('admin', 'member');

-- team.id is browser-generated UUIDv7 (global convention), supplied by the API on create.
create table public.teams (
  id uuid primary key,
  name text not null,
  created_by uuid not null references public.profiles (id),
  retro_cadence_days integer not null default 14 check (retro_cadence_days > 0),
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.team_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
