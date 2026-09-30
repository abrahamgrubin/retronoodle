-- Every table gets RLS enabled and no policies. Browsers never write to Postgres and never
-- read it directly either (they use `GET` routes on the API and Realtime for listening); the API
-- and worker connect with the service role key, which bypasses RLS. This leaves the anon and
-- authenticated roles with zero access to every table by default.
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.templates enable row level security;
alter table public.retros enable row level security;
alter table public.retro_columns enable row level security;
alter table public.topics enable row level security;
alter table public.cards enable row level security;
alter table public.card_reactions enable row level security;
alter table public.votes enable row level security;
alter table public.retro_participants enable row level security;
alter table public.group_suggestions enable row level security;
alter table public.action_items enable row level security;
alter table public.action_item_reviews enable row level security;
alter table public.topic_notes enable row level security;
alter table public.topic_summaries enable row level security;
alter table public.retro_events enable row level security;
