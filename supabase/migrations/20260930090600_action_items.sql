-- Action items belong to the team, not a single retro, so they carry over (RN-025).
-- `trello_card_id` is a P1 column (Trello integration) included now so the schema doesn't
-- change shape later.
create table public.action_items (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  source_retro_id uuid not null references public.retros (id) on delete cascade,
  source_topic_id uuid references public.topics (id) on delete set null,
  title text not null,
  owner_id uuid references public.profiles (id),
  due_date date,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'dropped')),
  origin text not null check (origin in ('ai', 'manual')),
  completed_at timestamptz,
  trello_card_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index action_items_team_id_idx on public.action_items (team_id);
create index action_items_source_retro_id_idx on public.action_items (source_retro_id);

-- One review outcome per item per retro's Review phase (RN-025).
create table public.action_item_reviews (
  id uuid primary key default gen_random_uuid(),
  action_item_id uuid not null references public.action_items (id) on delete cascade,
  retro_id uuid not null references public.retros (id) on delete cascade,
  outcome text not null check (outcome in ('done', 'in_progress', 'dropped', 'carried')),
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (action_item_id, retro_id)
);

-- One notes box per topic (RN-020); `topic_id` is the natural primary key.
create table public.topic_notes (
  topic_id uuid primary key references public.topics (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  updated_at timestamptz not null default now()
);

-- Each AI generation and each edit inserts a new version (RN-021); nothing is mutated in place.
create table public.topic_summaries (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  version integer not null,
  model text not null,
  prompt_version text not null,
  key_points jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  disagreements jsonb not null default '[]'::jsonb,
  proposed_action_items jsonb not null default '[]'::jsonb,
  edited boolean not null default false,
  edit_ratio numeric(5, 4),
  created_at timestamptz not null default now(),
  unique (topic_id, version)
);
