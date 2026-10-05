-- Status-change history for the team action-item list (RN-024): "every change goes to ...
-- history with actor and time." Append-only (no uniqueness constraint — the same item can change
-- status any number of times), unlike action_item_reviews (RN-025's one-row-per-item-per-retro
-- Review outcome, a different concern entirely).
create table public.action_item_status_changes (
  id uuid primary key default gen_random_uuid(),
  action_item_id uuid not null references public.action_items (id) on delete cascade,
  from_status text not null check (from_status in ('open', 'in_progress', 'done', 'dropped')),
  to_status text not null check (to_status in ('open', 'in_progress', 'done', 'dropped')),
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index action_item_status_changes_action_item_id_idx on public.action_item_status_changes (action_item_id);

alter table public.action_item_status_changes enable row level security;
