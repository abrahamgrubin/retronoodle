-- One row per dot (RN-018: "multiple dots on one topic are allowed"), so there's no natural
-- unique key; the id is server-generated when the mutation pipeline applies `vote.add`.
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  retro_id uuid not null references public.retros (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index votes_topic_id_idx on public.votes (topic_id);
create index votes_retro_id_user_id_idx on public.votes (retro_id, user_id);

-- Attendance, separate from team membership: a team member can open retros they didn't attend
-- (U3), so this only records who was actually present.
create table public.retro_participants (
  retro_id uuid not null references public.retros (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (retro_id, user_id)
);

-- AI grouping suggestions (RN-017), written by the worker job, not the browser.
create table public.group_suggestions (
  id uuid primary key default gen_random_uuid(),
  retro_id uuid not null references public.retros (id) on delete cascade,
  name text not null,
  card_ids uuid[] not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create index group_suggestions_retro_id_idx on public.group_suggestions (retro_id);
