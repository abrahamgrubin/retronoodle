-- Homework: AI agent team. group-summarizer writes a title+summary for each topic once grouping
-- locks in (group->vote) — shown on the Vote page in place of the group's cards, and editable by
-- the facilitator while voting is open. question-suggester writes opening questions for a topic
-- the moment it becomes current in Discuss. All three columns are null until their agent runs
-- (or, for the summary, until the facilitator writes their own).
alter table public.topics
  add column ai_group_summary_title text,
  add column ai_group_summary text,
  add column ai_discussion_questions jsonb;
