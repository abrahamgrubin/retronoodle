-- A built-in template for Lean Coffee: one column where everyone writes the topics they want to
-- talk about, which the existing Vote and Discuss phases then order and work through.
--
-- Inserted here rather than appended to supabase/seed.sql like the first four built-ins: seed.sql
-- only ever runs against a local stack and in CI (`supabase db reset`), so a row added there would
-- never reach production, which sees migrations alone. `db reset` applies migrations before the
-- seed, so this row is present locally too — it must NOT also be listed in seed.sql or that
-- insert would hit this primary key.
--
-- One column is deliberate and enough: the code appends a blue Action items column at retro start
-- (RN-007), so the board still opens with two. Nothing reads a fixed column count.
--
-- No image_url: apps/web/public/templates/ has a PNG per built-in and this one has none yet; the
-- picker card renders without one (App.tsx guards on `template.imageUrl`).
insert into public.templates (id, team_id, source, name, columns, description, image_url) values (
  '00000000-0000-4000-8000-0000000000e6',
  null,
  'builtin',
  'Lean Coffee',
  '[
    {"title": "To Discuss", "prompt": "Write down any topic you would like to discuss.", "color": "green"}
  ]'::jsonb,
  'One column of topics: everyone writes what they want to talk about, the team votes, and the highest-voted topics get discussed in turn.',
  null
);
