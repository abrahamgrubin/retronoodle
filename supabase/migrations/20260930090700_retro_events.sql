-- The ordered event log behind the mutation pipeline (RN-008). `seq` is assigned inside the
-- same transaction as the write, under `SELECT ... FOR UPDATE` on the retro row, so it's gapless
-- and strictly increasing per retro. `mutation_id` is unique per retro so a replayed
-- `POST /retros/:id/mutations` is idempotent.
create table public.retro_events (
  id uuid primary key default gen_random_uuid(),
  retro_id uuid not null references public.retros (id) on delete cascade,
  seq integer not null,
  mutation_id uuid not null,
  type text not null,
  payload jsonb not null,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (retro_id, seq),
  unique (retro_id, mutation_id)
);

create index retro_events_retro_id_seq_idx on public.retro_events (retro_id, seq);
