-- The one Realtime listen policy (Design 4.9). RealtimeBus (RN-004) is the only module that
-- sends; these policies only gate who may *subscribe*, using Supabase's Realtime Authorization
-- (RLS on realtime.messages, keyed by realtime.topic()).
--
-- Two private channel shapes:
--   retro:{retroId}  - server-send only; any member of the retro's team may listen.
--   user:{userId}    - server-send only; only that user may listen.
--
-- RN-004 is the spike that proves this policy actually authorizes a subscription against a
-- running Realtime container; if it doesn't hold up, that story documents the fallback.
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
