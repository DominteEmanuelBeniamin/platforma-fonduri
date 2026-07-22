-- Issue #53: project content is prepared privately, then published to the client.
alter table public.project_phases
  add column if not exists visibility text;

alter table public.project_activities
  add column if not exists visibility text;

alter table public.document_requirements
  add column if not exists visibility text;

update public.project_phases set visibility = 'published' where visibility is null;
update public.project_activities set visibility = 'published' where visibility is null;
update public.document_requirements set visibility = 'published' where visibility is null;

alter table public.project_phases
  alter column visibility set default 'draft',
  alter column visibility set not null;

alter table public.project_activities
  alter column visibility set default 'draft',
  alter column visibility set not null;

alter table public.document_requirements
  alter column visibility set default 'draft',
  alter column visibility set not null;

alter table public.project_phases
  drop constraint if exists project_phases_visibility_check,
  add constraint project_phases_visibility_check check (visibility in ('draft', 'published'));

alter table public.project_activities
  drop constraint if exists project_activities_visibility_check,
  add constraint project_activities_visibility_check check (visibility in ('draft', 'published'));

alter table public.document_requirements
  drop constraint if exists document_requirements_visibility_check,
  add constraint document_requirements_visibility_check check (visibility in ('draft', 'published'));
