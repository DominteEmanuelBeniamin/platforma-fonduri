-- Retention metadata is deliberately inert until an operator supplies policy
-- durations and enables a policy. NULL deadlines therefore fail closed.

alter table public.projects
  add column if not exists document_retention_until timestamptz,
  add column if not exists chat_retention_until timestamptz,
  add column if not exists retention_basis text,
  add column if not exists legal_hold_at timestamptz,
  add column if not exists legal_hold_reason text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

alter table public.template_document_requirements
  add column if not exists retention_class text not null default 'project_record';

alter table public.document_requirements
  add column if not exists retention_class text not null default 'project_record',
  add column if not exists retention_until timestamptz,
  add column if not exists purge_after timestamptz;

alter table public.files
  add column if not exists purge_after timestamptz;

alter table public.project_chat_messages
  add column if not exists purge_after timestamptz;

alter table public.private_messages
  add column if not exists purge_after timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.template_document_requirements'::regclass
      and conname = 'template_document_requirements_retention_class_check'
  ) then
    alter table public.template_document_requirements
      add constraint template_document_requirements_retention_class_check
      check (retention_class in (
        'project_record',
        'procurement_record',
        'financial_record',
        'employment_evidence',
        'construction_record',
        'public_template',
        'temporary'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_requirements'::regclass
      and conname = 'document_requirements_retention_class_check'
  ) then
    alter table public.document_requirements
      add constraint document_requirements_retention_class_check
      check (retention_class in (
        'project_record',
        'procurement_record',
        'financial_record',
        'employment_evidence',
        'construction_record',
        'public_template',
        'temporary'
      ));
  end if;
end;
$$;

create table if not exists public.retention_policies (
  policy_key text primary key,
  retention_hours bigint null,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now(),
  constraint retention_policies_hours_positive
    check (retention_hours is null or retention_hours > 0),
  constraint retention_policies_key_check
    check (policy_key in (
      'orphan_upload',
      'soft_delete_grace',
      'project_document',
      'project_chat',
      'private_chat',
      'audit',
      'notifications',
      'test_data'
    ))
);

create table if not exists public.data_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  execute_after timestamptz not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text null,
  requested_by uuid null references public.profiles(id) on delete set null,
  reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint data_deletion_jobs_target_type_check
    check (target_type in (
      'project',
      'document',
      'user',
      'project_chat_message',
      'private_message',
      'orphan_upload'
    )),
  constraint data_deletion_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed')),
  constraint data_deletion_jobs_attempts_check
    check (attempts >= 0),
  constraint data_deletion_jobs_last_error_short
    check (last_error is null or char_length(last_error) <= 500)
);

alter table public.data_deletion_jobs
  add column if not exists completed_at timestamptz;

-- Add the checks too when a partially-created table already exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.retention_policies'::regclass
      and conname = 'retention_policies_hours_positive'
  ) then
    alter table public.retention_policies
      add constraint retention_policies_hours_positive
      check (retention_hours is null or retention_hours > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.retention_policies'::regclass
      and conname = 'retention_policies_key_check'
  ) then
    alter table public.retention_policies
      add constraint retention_policies_key_check
      check (policy_key in (
        'orphan_upload',
        'soft_delete_grace',
        'project_document',
        'project_chat',
        'private_chat',
        'audit',
        'notifications',
        'test_data'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.data_deletion_jobs'::regclass
      and conname = 'data_deletion_jobs_target_type_check'
  ) then
    alter table public.data_deletion_jobs
      add constraint data_deletion_jobs_target_type_check
      check (target_type in (
        'project',
        'document',
        'user',
        'project_chat_message',
        'private_message',
        'orphan_upload'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.data_deletion_jobs'::regclass
      and conname = 'data_deletion_jobs_status_check'
  ) then
    alter table public.data_deletion_jobs
      add constraint data_deletion_jobs_status_check
      check (status in ('queued', 'processing', 'completed', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.data_deletion_jobs'::regclass
      and conname = 'data_deletion_jobs_attempts_check'
  ) then
    alter table public.data_deletion_jobs
      add constraint data_deletion_jobs_attempts_check
      check (attempts >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.data_deletion_jobs'::regclass
      and conname = 'data_deletion_jobs_last_error_short'
  ) then
    alter table public.data_deletion_jobs
      add constraint data_deletion_jobs_last_error_short
      check (last_error is null or char_length(last_error) <= 500);
  end if;
end;
$$;

insert into public.retention_policies (policy_key, enabled, retention_hours, description)
values
  ('orphan_upload', false, null, 'Incomplete document upload batches and unreferenced storage objects'),
  ('soft_delete_grace', false, null, 'Grace period before soft-deleted records may be purged'),
  ('project_document', false, null, 'Project document retention'),
  ('project_chat', false, null, 'Project chat retention'),
  ('private_chat', false, null, 'Private chat retention'),
  ('audit', false, null, 'Audit log retention'),
  ('notifications', false, null, 'Notification retention'),
  ('test_data', false, null, 'Test data retention')
on conflict (policy_key) do nothing;

create index if not exists projects_document_retention_due_idx
  on public.projects (document_retention_until)
  where document_retention_until is not null and legal_hold_at is null;

create index if not exists projects_chat_retention_due_idx
  on public.projects (chat_retention_until)
  where chat_retention_until is not null and legal_hold_at is null;

create index if not exists projects_legal_hold_idx
  on public.projects (legal_hold_at)
  where legal_hold_at is not null;

create index if not exists projects_soft_deleted_idx
  on public.projects (deleted_at)
  where deleted_at is not null;

create index if not exists document_requirements_purge_after_idx
  on public.document_requirements (purge_after)
  where purge_after is not null;

create index if not exists files_purge_after_idx
  on public.files (purge_after)
  where purge_after is not null;

create index if not exists project_chat_messages_purge_after_idx
  on public.project_chat_messages (purge_after)
  where purge_after is not null;

create index if not exists private_messages_purge_after_idx
  on public.private_messages (purge_after)
  where purge_after is not null;

create index if not exists data_deletion_jobs_due_idx
  on public.data_deletion_jobs (execute_after)
  where status = 'queued';

create unique index if not exists data_deletion_jobs_outstanding_target_idx
  on public.data_deletion_jobs (target_type, target_id)
  where status in ('queued', 'processing');

alter table public.retention_policies enable row level security;
alter table public.data_deletion_jobs enable row level security;

revoke all on table public.retention_policies from public, anon, authenticated;
revoke all on table public.data_deletion_jobs from public, anon, authenticated;
grant all on table public.retention_policies to service_role;
grant all on table public.data_deletion_jobs to service_role;
