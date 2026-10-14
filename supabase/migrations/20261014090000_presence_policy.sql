-- RN-044: a third private channel shape, `presence:{retroId}` — any member of the retro's team
-- may both listen (receive presence state) and track (post their own), unlike the two channels
-- RN-004's own policy covers (retro:% and user:% are server-send only). Supabase's Realtime
-- Authorization maps "receive" to a SELECT policy and "send" (a broadcast, or here, a presence
-- track) to an INSERT policy on the same realtime.messages table — see that migration's own
-- comment for why these run against public.is_retro_team_member() rather than a plain subquery.
create policy "team members can listen to their retro's presence channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() like 'presence:%'
    and public.is_retro_team_member(split_part(realtime.topic(), ':', 2)::uuid, (select auth.uid()))
  );

create policy "team members can track presence on their retro's channel"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'presence:%'
    and public.is_retro_team_member(split_part(realtime.topic(), ':', 2)::uuid, (select auth.uid()))
  );
