#!/usr/bin/env bash
# Verifies two RN-002 acceptance criteria against a running local Supabase stack:
#   1. The anon role reads zero rows from every public table.
#   2. Inserting two retro_events with the same (retro_id, seq) fails.
#
# Run after `supabase db reset` (migrations + seed applied):
#   ./supabase/tests/schema-checks.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
set -euo pipefail

DB_URL="${1:?usage: schema-checks.sh <db-url>}"

echo "== anon reads zero rows from every public table =="
tables=$(psql "$DB_URL" -tAc "select tablename from pg_tables where schemaname = 'public' order by 1;")
fail=0
for t in $tables; do
  n=$(psql "$DB_URL" -tAc "set role anon; select count(*) from public.\"$t\";")
  if [ "$n" != "0" ]; then
    echo "FAIL: $t returned $n rows to anon (expected 0)"
    fail=1
  fi
done
if [ "$fail" != "0" ]; then
  exit 1
fi
echo "ok: every public table is empty to anon"

echo "== duplicate (retro_id, seq) is rejected =="
if psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/dup-seq.out 2>/tmp/dup-seq.err <<'SQL'
begin;
insert into public.teams (id, name, created_by)
values ('00000000-0000-0000-0000-00000000a003', 'CI Check Team', '00000000-0000-0000-0000-0000000000d0');
insert into public.retros (id, team_id, facilitator_id, template_id, name, join_code_hash)
values ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-00000000a003',
        '00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000e1',
        'CI Check Retro', 'ci-check-dup-seq-hash');
insert into public.retro_events (retro_id, seq, mutation_id, type, payload)
values ('00000000-0000-0000-0000-00000000a004', 1, gen_random_uuid(), 'card.create', '{}');
insert into public.retro_events (retro_id, seq, mutation_id, type, payload)
values ('00000000-0000-0000-0000-00000000a004', 1, gen_random_uuid(), 'card.edit', '{}');
rollback;
SQL
then
  echo "FAIL: duplicate (retro_id, seq) was accepted"
  cat /tmp/dup-seq.out /tmp/dup-seq.err
  exit 1
fi
echo "ok: duplicate (retro_id, seq) is rejected"
