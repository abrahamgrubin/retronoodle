-- RN-007 acceptance criterion: "retros stores the template source so the 'generated formats
-- used' metric can be computed later" — a denormalized snapshot, not just derivable via a join
-- to templates, since a template's own `source` could in principle change after retros already
-- point at it (templates never get deleted out from under a retro, but this metric should
-- reflect what the retro was actually started from).
alter table public.retros add column template_source text;

update public.retros r
set template_source = t.source
from public.templates t
where t.id = r.template_id
  and r.template_source is null;

alter table public.retros
  alter column template_source set not null,
  add constraint retros_template_source_check check (template_source in ('builtin', 'custom'));
