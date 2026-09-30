-- Columns copied from the template into the retro at start (RN-007); server-generated since
-- copying is a server-side side effect, not a direct client mutation.
create table public.retro_columns (
  id uuid primary key,
  retro_id uuid not null references public.retros (id) on delete cascade,
  title text not null,
  prompt text,
  color text not null,
  kind text not null default 'standard' check (kind in ('standard', 'action_items')),
  position integer not null,
  created_at timestamptz not null default now(),
  unique (retro_id, position)
);

-- Topics group cards for discussion and voting (RN-015). `topicId` is supplied by the client
-- in `topic.createFromCards`, so this is a browser-generated UUIDv7 like cards.
create table public.topics (
  id uuid primary key,
  retro_id uuid not null references public.retros (id) on delete cascade,
  column_id uuid not null references public.retro_columns (id) on delete cascade,
  name text not null,
  -- Text sort key for the discuss queue (RN-019); null until the topic has a place in the queue.
  discussion_order text,
  vote_count integer not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index topics_retro_id_idx on public.topics (retro_id);

-- Cards. `id` and `position` (a fractional text sort key, RN-014) are browser-generated.
create table public.cards (
  id uuid primary key,
  retro_id uuid not null references public.retros (id) on delete cascade,
  column_id uuid not null references public.retro_columns (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  topic_id uuid references public.topics (id) on delete set null,
  body text not null check (char_length(body) <= 500),
  position text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cards_retro_id_idx on public.cards (retro_id);
create index cards_column_id_idx on public.cards (column_id);
create index cards_topic_id_idx on public.cards (topic_id);

-- One reaction per (card, user, emoji); the triple is the natural key (RN-016).
create table public.card_reactions (
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id, emoji)
);
