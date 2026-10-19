-- A 5th built-in template, sorting the sprint by how much energy each thing gave or took.
--
-- Inserted here rather than appended to supabase/seed.sql like the first four: seed.sql only ever
-- runs against a local stack and in CI (`supabase db reset`), so a row added there would never
-- reach production, which sees migrations alone. `db reset` applies migrations before the seed,
-- so this row is present locally too — it must NOT also be listed in seed.sql or that insert
-- would hit this primary key.
--
-- Column colors follow the convention the other built-ins use (green, pink, yellow, purple in
-- order); the code appends a blue Action items column at retro start (RN-007), never stored here.
-- image_url points at apps/web/public/templates/, same as the other four (20261016120000).
insert into public.templates (id, team_id, source, name, columns, description, image_url) values (
  '00000000-0000-4000-8000-0000000000e5',
  null,
  'builtin',
  'Energy Check',
  '[
    {"title": "Recharged Energy", "prompt": "What gave you energy?", "color": "green"},
    {"title": "Slightly Drained", "prompt": "What took a little bit of energy?", "color": "pink"},
    {"title": "Moderately Drained", "prompt": "What took a decent amount of energy?", "color": "yellow"},
    {"title": "Severely Drained", "prompt": "What took a lot of energy?", "color": "purple"}
  ]'::jsonb,
  'Sort the sprint by how much energy each thing gave or took, from recharging to severely draining.',
  '/templates/energy.png'
);
