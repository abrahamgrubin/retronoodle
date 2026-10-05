-- RN-027: "Claude spend cap $5/month in config." One row per calendar month (UTC, 'YYYY-MM'),
-- accumulated in place as each AI job records its own call's estimated cost.
create table public.ai_usage (
  month text primary key,
  total_cost_usd numeric(10, 4) not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ai_usage enable row level security;
