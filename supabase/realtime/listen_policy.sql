-- The one Realtime listen policy (Design 4.9). RealtimeBus (RN-004) is the only module that
-- sends; these policies only gate who may *subscribe*, using Supabase's Realtime Authorization
-- (RLS on realtime.messages, keyed by realtime.topic()).
--
-- Two private channel shapes:
--   retro:{retroId}  - server-send only; any member of the retro's team may listen.
--   user:{userId}    - server-send only; only that user may listen.
--
-- NOT a migration (supabase/migrations/ only): `realtime.messages` is owned by
-- `supabase_realtime_admin`, and the `postgres` role used by both `supabase db reset` and a
-- project's SQL Editor is not a superuser or member of that role, so `db reset` fails here on
-- both a fresh local stack and a hosted project (confirmed against both while building RN-002).
-- RN-004 is the spike that finds the mechanism that actually works — running this by hand from
-- a role that does own the table, a different grant, or the dashboard's Realtime policy UI if
-- one exists for the target Supabase version — and either replaces this file or documents the
-- public-channel fallback if none of that holds up.
alter table realtime.messages enable row level security;

create policy "team members can listen to their retro channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() like 'retro:%'
    and exists (
      select 1
      from public.retros r
      join public.team_members tm on tm.team_id = r.team_id
      where r.id::text = split_part(realtime.topic(), ':', 2)
        and tm.user_id = (select auth.uid())
    )
  );

create policy "users can listen to their own private channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'user:' || (select auth.uid())::text
  );
