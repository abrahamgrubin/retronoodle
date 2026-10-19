-- Deleting a retro is a soft delete: `action_items.source_retro_id` is `on delete cascade`, but
-- action items deliberately outlive the retro that created them ("Action items belong to the
-- team, not a single retro, so they carry over" — 20260930090600_action_items.sql), so a hard
-- delete would silently take open items carried into later retros off the team's Action items
-- page with it. Stamping a column instead keeps every row — and every `source_retro_id` name
-- lookup — intact, and is reversible if the wrong retro is deleted.
alter table public.retros add column deleted_at timestamptz;
