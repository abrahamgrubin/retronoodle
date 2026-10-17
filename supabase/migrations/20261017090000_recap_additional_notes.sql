-- RN-045 follow-up: facilitator-editable free text on the recap page, no bearing on the recap
-- agent's own output (topic_summaries/decisions) — defaults to empty, same "nothing written yet"
-- convention as topic_notes.
alter table public.retro_recaps add column additional_notes text not null default '';
