-- Multiple attachments for document requests and template document requirements.
-- Existing attachment_path columns stay in place for compatibility during rollout.

create table if not exists public.document_requirement_attachments (
  id uuid primary key default gen_random_uuid(),
  document_requirement_id uuid references public.document_requirements(id) on delete cascade,
  template_document_requirement_id uuid references public.template_document_requirements(id) on delete cascade,
  source_template_attachment_id uuid references public.document_requirement_attachments(id) on delete set null,
  storage_path text not null,
  original_name text,
  mime_type text,
  file_size bigint,
  order_index integer not null default 0,
  missing_at timestamptz,
  missing_checked_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint document_requirement_attachments_one_owner_chk check (
    (document_requirement_id is not null)::integer
    + (template_document_requirement_id is not null)::integer
    = 1
  ),
  constraint document_requirement_attachments_file_size_chk check (
    file_size is null or file_size >= 0
  )
);

create index if not exists document_requirement_attachments_document_idx
  on public.document_requirement_attachments(document_requirement_id, order_index, created_at)
  where document_requirement_id is not null;

create index if not exists document_requirement_attachments_template_document_idx
  on public.document_requirement_attachments(template_document_requirement_id, order_index, created_at)
  where template_document_requirement_id is not null;

create index if not exists document_requirement_attachments_source_template_idx
  on public.document_requirement_attachments(source_template_attachment_id)
  where source_template_attachment_id is not null;

create unique index if not exists document_requirement_attachments_document_storage_uidx
  on public.document_requirement_attachments(document_requirement_id, storage_path)
  where document_requirement_id is not null;

create unique index if not exists document_requirement_attachments_template_storage_uidx
  on public.document_requirement_attachments(template_document_requirement_id, storage_path)
  where template_document_requirement_id is not null;

insert into public.document_requirement_attachments (
  template_document_requirement_id,
  storage_path,
  original_name,
  order_index,
  missing_at,
  missing_checked_at,
  created_at
)
select
  tdr.id,
  tdr.attachment_path,
  tdr.attachment_original_name,
  0,
  tdr.attachment_missing_at,
  tdr.attachment_missing_checked_at,
  coalesce(tdr.created_at, now())
from public.template_document_requirements tdr
where tdr.attachment_path is not null
  and not exists (
    select 1
    from public.document_requirement_attachments existing
    where existing.template_document_requirement_id = tdr.id
      and existing.storage_path = tdr.attachment_path
  );

insert into public.document_requirement_attachments (
  document_requirement_id,
  source_template_attachment_id,
  storage_path,
  original_name,
  order_index,
  missing_at,
  missing_checked_at,
  created_by,
  created_at
)
select
  dr.id,
  template_attachment.id,
  dr.attachment_path,
  dr.attachment_original_name,
  0,
  dr.attachment_missing_at,
  dr.attachment_missing_checked_at,
  dr.created_by,
  coalesce(dr.created_at, now())
from public.document_requirements dr
left join public.document_requirement_attachments template_attachment
  on template_attachment.template_document_requirement_id = dr.source_template_document_requirement_id
  and template_attachment.storage_path = dr.attachment_path
where dr.attachment_path is not null
  and not exists (
    select 1
    from public.document_requirement_attachments existing
    where existing.document_requirement_id = dr.id
      and existing.storage_path = dr.attachment_path
  );
