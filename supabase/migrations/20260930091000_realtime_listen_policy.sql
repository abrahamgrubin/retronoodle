-- The one Realtime listen policy (Design 4.9). RealtimeBus (RN-004) is the only module that
-- sends; these policies only gate who may *subscribe*, using Supabase's Realtime Authorization
-- (RLS on realtime.messages, keyed by realtime.topic()).
--
-- Two private channel shapes:
--   retro:{retroId}  - server-send only; any member of the retro's team may listen.
--   user:{userId}    - server-send only; only that user may listen.
--
-- Do NOT add `alter table realtime.messages enable row level security` here. RLS is already
-- enabled on that table by default, and Postgres checks ownership before checking whether the
-- setting would actually change — so a no-op ALTER TABLE still fails with
-- "must be owner of table messages" (it's owned by supabase_realtime_admin, not postgres). The
-- CREATE POLICY statements below work anyway: Supabase's supautils extension grants postgres
-- elevated policy-operation rights on this specific table even without owning it.
-- https://supabase.com/docs/guides/troubleshooting/realtime-must-be-owner-of-table-messages

-- A policy's USING clause runs as the connecting client's own role (`authenticated`), not as
-- postgres — so a plain subquery against public.retros/public.team_members sees nothing, since
-- those tables have deny-all RLS for every role but service_role. This SECURITY DEFINER
-- function runs as its owner (postgres, which bypasses RLS) so the membership check can see the
-- tables regardless of the caller's own RLS. (Found by RN-004: the naive policy silently
-- rejected every legitimate subscriber, not just non-members.)
create or replace function public.is_retro_team_member(p_retro_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.retros r
    join public.team_members tm on tm.team_id = r.team_id
    where r.id = p_retro_id
      and tm.user_id = p_user_id
  );
$$;

grant execute on function public.is_retro_team_member(uuid, uuid) to authenticated;

create policy "team members can listen to their retro channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() like 'retro:%'
    and public.is_retro_team_member(split_part(realtime.topic(), ':', 2)::uuid, (select auth.uid()))
  );

create policy "users can listen to their own private channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'user:' || (select auth.uid())::text
  );
