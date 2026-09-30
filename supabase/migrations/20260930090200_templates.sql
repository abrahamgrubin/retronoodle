-- Built-in and team-custom retro templates. `columns` holds [{title, prompt, color}, ...].
-- The code always appends an Action items column (kind = 'action_items') at write time;
-- templates never store it (RN-007).
create table public.templates (
  id uuid primary key,
  team_id uuid references public.teams (id) on delete cascade,
  source text not null default 'custom' check (source in ('builtin', 'custom')),
  name text not null,
  columns jsonb not null,
  created_at timestamptz not null default now(),
  constraint templates_builtin_has_no_team check (
    (source = 'builtin' and team_id is null) or (source = 'custom' and team_id is not null)
  )
);
