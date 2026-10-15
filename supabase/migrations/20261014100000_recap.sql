-- RN-045: one row per retro, written by the recap agent team (ai.generateRecap) once at close.
-- Only `topic_summaries`/`decisions` are the AI's own output — action items, undiscussed topics
-- and attendance are deliberately NOT stored here; the recap route reads those live from their
-- own authoritative tables on every request instead (apps/api/src/routes/recap.ts), so e.g. an
-- action item's status always reflects reality even if it changes after this job ran once.
create table public.retro_recaps (
  id uuid primary key default gen_random_uuid(),
  retro_id uuid not null unique references public.retros (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'ready', 'unavailable')),
  topic_summaries jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.retro_recaps enable row level security;
