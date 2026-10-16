-- Template picker cards gain a description and a preview image alongside the existing name and
-- column-color dots (both nullable: a team's own custom templates, created before or after this,
-- never have to set either).
alter table public.templates
  add column description text,
  add column image_url text;

update public.templates set
  description = 'Three columns for deciding what the team should start doing, stop doing, and keep doing.',
  image_url = '/templates/start-stop-continue.svg'
where id = '00000000-0000-4000-8000-0000000000e1';

update public.templates set
  description = 'Surface how the team felt this sprint: what frustrated, disappointed, and delighted them.',
  image_url = '/templates/mad-sad-glad.svg'
where id = '00000000-0000-4000-8000-0000000000e2';

update public.templates set
  description = 'Reflect on what the team liked, learned, lacked, and longed for.',
  image_url = '/templates/4ls.svg'
where id = '00000000-0000-4000-8000-0000000000e3';

update public.templates set
  description = 'A metaphor for the team journey: what is pushing you forward, holding you back, the risks ahead, and the destination.',
  image_url = '/templates/sailboat.svg'
where id = '00000000-0000-4000-8000-0000000000e4';
