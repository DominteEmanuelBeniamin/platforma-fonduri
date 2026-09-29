-- Allow admins to disable every automatic deadline reminder for a project.
-- Existing projects remain enabled by default.

alter table public.projects
  add column if not exists automatic_reminders_enabled boolean not null default true;

comment on column public.projects.automatic_reminders_enabled is
  'Controls automatic deadline reminder emails sent to project clients and consultants.';
