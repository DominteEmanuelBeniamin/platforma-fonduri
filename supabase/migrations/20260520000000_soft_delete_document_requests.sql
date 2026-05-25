alter table public.document_requirements
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text,
  add column if not exists attachment_original_name text,
  add column if not exists attachment_missing_at timestamptz,
  add column if not exists attachment_missing_checked_at timestamptz,
  add column if not exists source_template_document_requirement_id uuid references public.template_document_requirements(id);

alter table public.files
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

alter table public.template_document_requirements
  add column if not exists is_active boolean not null default true,
  add column if not exists attachment_original_name text,
  add column if not exists attachment_missing_at timestamptz,
  add column if not exists attachment_missing_checked_at timestamptz;

alter table public.project_phases
  add column if not exists source_template_phase_id uuid references public.template_phases(id);

alter table public.project_activities
  add column if not exists source_template_activity_id uuid references public.template_activities(id);

create table if not exists public.document_request_reviews (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.document_requirements(id) on delete cascade,
  action text not null check (action in ('approved', 'rejected')),
  reason text,
  reviewed_version_number integer not null,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz not null default now(),
  constraint document_request_reviews_rejected_reason_chk
    check (action <> 'rejected' or nullif(btrim(reason), '') is not null),
  constraint document_request_reviews_approved_reason_chk
    check (action <> 'approved' or reason is null)
);

create index if not exists document_requirements_not_deleted_idx
  on public.document_requirements(project_id, created_at desc)
  where deleted_at is null;

create index if not exists files_requirement_not_deleted_idx
  on public.files(requirement_id, version_number desc, created_at desc)
  where deleted_at is null;

create index if not exists document_request_reviews_requirement_latest_idx
  on public.document_request_reviews(requirement_id, reviewed_at desc);

insert into public.document_request_reviews (
  requirement_id,
  action,
  reason,
  reviewed_version_number,
  reviewed_by,
  reviewed_at
)
select distinct on (dr.id)
  dr.id,
  'rejected',
  nullif(btrim(f.comments), ''),
  f.version_number,
  f.uploaded_by,
  coalesce(f.created_at, now())
from public.document_requirements dr
join public.files f
  on f.requirement_id = dr.id
  and f.deleted_at is null
  and nullif(btrim(f.comments), '') is not null
where dr.status = 'rejected'
  and not exists (
    select 1
    from public.document_request_reviews existing
    where existing.requirement_id = dr.id
      and existing.action = 'rejected'
  )
order by dr.id, f.version_number desc, f.created_at desc;

create unique index if not exists project_phases_project_source_template_idx
  on public.project_phases(project_id, source_template_phase_id)
  where source_template_phase_id is not null;

create unique index if not exists project_activities_phase_source_template_idx
  on public.project_activities(phase_id, source_template_activity_id)
  where source_template_activity_id is not null;

create unique index if not exists document_requirements_project_source_template_idx
  on public.document_requirements(project_id, source_template_document_requirement_id)
  where source_template_document_requirement_id is not null;

create or replace view public.template_document_attachment_stale_references as
select
  tdr.id,
  tdr.template_activity_id,
  tdr.name,
  tdr.attachment_path,
  tdr.attachment_missing_at,
  tdr.attachment_missing_checked_at
from public.template_document_requirements tdr
where tdr.attachment_path is not null
  and tdr.attachment_missing_at is not null;
