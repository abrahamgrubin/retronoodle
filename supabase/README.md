# supabase/

Supabase CLI migrations, seed data and RLS policies.

- `migrations/` — the v0.1 schema (RN-002): profiles, teams, retros, cards, topics, votes,
  action items and the ordered event log behind the mutation pipeline. Every table has row
  level security enabled with no policies, except the Realtime listen policy on
  `realtime.messages` (RN-004, Design 4.9) that lets a retro's team members and a user's own
  private channel subscribe. The API and worker connect with the service role key, which
  bypasses RLS; browsers never write to Postgres directly.
- `seed.sql` — a local-dev-only Demo Team and the 4 built-in templates.
- `tests/schema-checks.sh` — run after `supabase db reset` to check the anon role reads zero
  rows from every table and that `retro_events` rejects a duplicate `(retro_id, seq)`.

**A note on the Realtime listen policy migration**: an earlier version of it included
`alter table realtime.messages enable row level security`, which fails with
`must be owner of table messages` — `realtime.messages` is owned by `supabase_realtime_admin`,
and Postgres checks ownership before checking whether a setting would even change, so the ALTER
fails even though RLS is already on by default. The `create policy` statements work fine on
their own: Supabase's `supautils` extension grants `postgres` elevated policy-operation rights
on that specific table without owning it. See
[Supabase's troubleshooting doc](https://supabase.com/docs/guides/troubleshooting/realtime-must-be-owner-of-table-messages)
if this resurfaces.

**A second gotcha, found live (RN-004)**: a policy's `USING` clause runs as the connecting
client's own role (`authenticated`), not as `postgres` — so a plain subquery against
`public.retros`/`public.team_members` inside the retro-channel policy saw nothing and silently
rejected every subscriber, including legitimate team members, since those tables have their own
deny-all RLS for every role but `service_role`. The fix is `public.is_retro_team_member()`, a
`SECURITY DEFINER` function (owned by `postgres`, which bypasses RLS) that the policy calls
instead of querying those tables directly. Verified against a real hosted project with real
signed-in users: a team member subscribes successfully, an outsider cannot — see
`apps/api/src/realtime/RealtimeBus.integration.test.ts`.

## Local development

```
supabase start
supabase db reset
./supabase/tests/schema-checks.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Requires Docker. Generate TypeScript types after schema changes with:

```
supabase gen types typescript --local > packages/shared/src/db/database.types.ts
```

(`packages/shared/src/db/database.types.ts` is currently hand-authored to match the migrations,
since it was written without a local Docker stack available — regenerate it for real the first
time you run the command above, and diff before committing to make sure nothing drifted.)
