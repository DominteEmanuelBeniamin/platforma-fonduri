alter table public.project_templates
  add column if not exists status text;

update public.project_templates
set status = 'published'
where status is null;

alter table public.project_templates
  alter column status set default 'draft',
  alter column status set not null;

alter table public.project_templates
  add constraint project_templates_status_check
  check (status in ('draft', 'published'));
