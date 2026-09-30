# supabase/

Supabase CLI migrations, seed data and RLS policies.

- `migrations/` — the v0.1 schema (RN-002): profiles, teams, retros, cards, topics, votes,
  action items and the ordered event log behind the mutation pipeline. Every table has row
  level security enabled with no policies, except the Realtime listen policy on
  `realtime.messages` that lets a retro's team members and a user's own private channel
  subscribe (Design 4.9). The API and worker connect with the service role key, which bypasses
  RLS; browsers never write to Postgres directly.
- `seed.sql` — a local-dev-only Demo Team and the 4 built-in templates.
- `tests/schema-checks.sh` — run after `supabase db reset` to check the anon role reads zero
  rows from every table and that `retro_events` rejects a duplicate `(retro_id, seq)`.

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
