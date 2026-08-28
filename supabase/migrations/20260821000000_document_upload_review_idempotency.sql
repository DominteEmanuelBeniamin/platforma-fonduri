-- Issue #78, Phase 3: retry-safe upload batches and reviews.

alter table public.files
  add column if not exists upload_batch_id uuid null;

create unique index if not exists files_requirement_upload_batch_storage_uidx
  on public.files(requirement_id, upload_batch_id, storage_path)
  where upload_batch_id is not null;

-- Keep the write side of complete/review in one transaction. The API performs
-- access checks first; only the service-role database client may execute these
-- functions.
create or replace function public.complete_document_upload_batch(
  p_requirement_id uuid,
  p_upload_batch_id uuid,
  p_version_number integer,
  p_uploaded_by uuid,
  p_rows jsonb,
  p_ip_address text default null
)
returns table(created boolean, file_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requirement_row public.document_requirements%rowtype;
  existing_count integer;
  requested_count integer;
  inserted_count integer;
  profile_email text;
  project_title text;
  file_names text;
  storage_prefix text;
begin
  if p_upload_batch_id is null
     or p_version_number is null
     or p_version_number < 1
     or coalesce(jsonb_typeof(p_rows), '') <> 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 50 then
    raise exception 'Invalid document upload batch' using errcode = 'P0001';
  end if;

  requested_count := jsonb_array_length(p_rows);

  select *
    into requirement_row
  from public.document_requirements
  where id = p_requirement_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Document request not found' using errcode = 'P0001';
  end if;

  if requirement_row.is_outgoing then
    raise exception 'Outgoing document requests do not accept uploads' using errcode = 'P0001';
  end if;

  storage_prefix := 'projects/' || requirement_row.project_id::text ||
    '/document-requests/' || p_requirement_id::text || '/v' || p_version_number::text || '/';

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where item->>'storage_path' is null
       or left(item->>'storage_path', length(storage_prefix)) <> storage_prefix
       or length(item->>'storage_path') <= length(storage_prefix)
       or left(item->>'storage_path', length(storage_prefix) + 1) = storage_prefix || '/'
       or right(item->>'storage_path', 1) = '/'
       or position('//' in substring(item->>'storage_path' from length(storage_prefix) + 1)) > 0
       or exists (
         select 1
         from regexp_split_to_table(substring(item->>'storage_path' from length(storage_prefix) + 1), '/') as segment
         where segment in ('.', '..')
       )
  ) then
    raise exception 'Upload path is outside the document request version directory' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where coalesce(item->'file_size', 'null'::jsonb) <> 'null'::jsonb
      and case
        when jsonb_typeof(item->'file_size') = 'number' then
          (item->>'file_size')::numeric < 0
          or (item->>'file_size')::numeric > 26214400
        else true
      end
  ) then
    raise exception 'File size must be between 0 and 26214400 bytes' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    group by item->>'storage_path'
    having count(*) > 1
  ) then
    raise exception 'Upload batch contains duplicate storage paths' using errcode = 'P0001';
  end if;

  select count(*)
    into existing_count
  from public.files
  where requirement_id = p_requirement_id
    and upload_batch_id = p_upload_batch_id
    and deleted_at is null;

  if existing_count > 0 then
    if existing_count <> requested_count
       or exists (
         select 1
         from public.files existing
         where existing.requirement_id = p_requirement_id
           and existing.upload_batch_id = p_upload_batch_id
           and existing.deleted_at is null
           and not exists (
             select 1
             from jsonb_array_elements(p_rows) as item
             where item->>'storage_path' = existing.storage_path
           )
       )
       or exists (
         select 1
         from jsonb_array_elements(p_rows) as item
         where not exists (
           select 1
           from public.files existing
           where existing.requirement_id = p_requirement_id
             and existing.upload_batch_id = p_upload_batch_id
             and existing.deleted_at is null
             and existing.storage_path = item->>'storage_path'
         )
       ) then
      raise exception 'Upload batch already exists with a different file set' using errcode = 'P0001';
    end if;

    return query select false, existing_count;
    return;
  end if;

  insert into public.files (
    requirement_id,
    upload_batch_id,
    storage_path,
    original_name,
    mime_type,
    file_size,
    version_number,
    uploaded_by
  )
  select
    p_requirement_id,
    p_upload_batch_id,
    item.storage_path,
    item.original_name,
    item.mime_type,
    item.file_size,
    p_version_number,
    p_uploaded_by
  from jsonb_to_recordset(p_rows) as item(
    storage_path text,
    original_name text,
    mime_type text,
    file_size bigint
  );

  get diagnostics inserted_count = row_count;
  if inserted_count <> requested_count then
    raise exception 'Document upload batch was not inserted completely' using errcode = 'P0001';
  end if;

  update public.document_requirements
  set status = 'review'
  where id = p_requirement_id
    and deleted_at is null;

  if not found then
    raise exception 'Document request disappeared during upload' using errcode = 'P0001';
  end if;

  select p.email
    into profile_email
  from public.profiles p
  where p.id = p_uploaded_by;

  select p.title
    into project_title
  from public.projects p
  where p.id = requirement_row.project_id;

  select string_agg(item->>'original_name', ', ')
    into file_names
  from jsonb_array_elements(p_rows) as item;

  insert into public.audit_logs (
    user_id,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    new_values,
    description,
    ip_address
  ) values (
    p_uploaded_by,
    'create',
    'file',
    p_requirement_id,
    requirement_row.name,
    jsonb_build_object(
      'requirement_id', p_requirement_id,
      'requirement_name', requirement_row.name,
      'project_id', requirement_row.project_id,
      'project_title', project_title,
      'file_count', requested_count,
      'version', p_version_number,
      'files', file_names,
      'upload_batch_id', p_upload_batch_id
    ),
    coalesce(profile_email, 'User') || ' a încărcat ' || requested_count ||
      ' fișier(e) pentru cererea "' || coalesce(requirement_row.name, p_requirement_id::text) ||
      '" din proiectul "' || coalesce(project_title, requirement_row.project_id::text) || '"',
    p_ip_address
  );

  return query select true, inserted_count;
end;
$$;

create or replace function public.review_document_request(
  p_request_id uuid,
  p_action text,
  p_reason text default null,
  p_reviewed_by uuid default null,
  p_ip_address text default null
)
returns table(created boolean, review_id uuid, reviewed_version_number integer, action text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requirement_row public.document_requirements%rowtype;
  latest_version integer;
  existing_review public.document_request_reviews%rowtype;
  inserted_review public.document_request_reviews%rowtype;
  profile_email text;
begin
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid review action' using errcode = 'P0001';
  end if;

  select *
    into requirement_row
  from public.document_requirements
  where id = p_request_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Document request not found' using errcode = 'P0001';
  end if;

  if requirement_row.is_outgoing then
    raise exception 'Outgoing document requests do not enter review' using errcode = 'P0001';
  end if;

  select f.version_number
    into latest_version
  from public.files f
  where f.requirement_id = p_request_id
    and f.deleted_at is null
  order by f.version_number desc, f.created_at desc, f.id desc
  limit 1;

  if latest_version is null then
    raise exception 'No uploaded files to review' using errcode = 'P0001';
  end if;

  -- Motivul se cere înaintea scurtcircuitului de idempotență și înaintea
  -- verificării de status: altfel o respingere fără motiv primește răspunsul
  -- greșit — 200 pe un replay, sau 409 „Reîncarcă pagina” pe o cerere care nu e
  -- în review — în loc de 400 „Scrie motivul respingerii”.
  if p_action = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'Notes are required for rejection' using errcode = 'P0001';
  end if;

  select *
    into existing_review
  from public.document_request_reviews r
  where r.requirement_id = p_request_id
    and r.reviewed_version_number = latest_version
  order by r.reviewed_at desc, r.id desc
  limit 1;

  if found then
    if existing_review.action <> p_action then
      raise exception 'This document version was already reviewed with another action' using errcode = 'P0001';
    end if;
    return query select false, existing_review.id, existing_review.reviewed_version_number, existing_review.action;
    return;
  end if;

  if requirement_row.status <> 'review' then
    raise exception 'Document request is not ready for review' using errcode = 'P0001';
  end if;

  insert into public.document_request_reviews (
    requirement_id,
    action,
    reason,
    reviewed_version_number,
    reviewed_by
  ) values (
    p_request_id,
    p_action,
    case when p_action = 'rejected' then nullif(btrim(p_reason), '') else null end,
    latest_version,
    p_reviewed_by
  )
  returning * into inserted_review;

  update public.document_requirements
  set status = p_action
  where id = p_request_id
    and deleted_at is null;

  if not found then
    raise exception 'Document request disappeared during review' using errcode = 'P0001';
  end if;

  select p.email
    into profile_email
  from public.profiles p
  where p.id = p_reviewed_by;

  insert into public.audit_logs (
    user_id,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    old_values,
    new_values,
    description,
    ip_address
  ) values (
    p_reviewed_by,
    'update',
    'document',
    p_request_id,
    coalesce(requirement_row.name, 'Document'),
    jsonb_build_object('status', requirement_row.status),
    jsonb_build_object(
      'status', p_action,
      'reviewed_version_number', latest_version,
      'reason', case when p_action = 'rejected' then nullif(btrim(p_reason), '') else null end
    ),
    coalesce(profile_email, 'User') || ' a ' ||
      case when p_action = 'approved' then 'aprobat' else 'respins' end ||
      ' documentul "' || coalesce(requirement_row.name, p_request_id::text) || '"' ||
      case when p_action = 'rejected' and nullif(btrim(p_reason), '') is not null
        then ' cu motivul: ' || btrim(p_reason)
        else '' end,
    p_ip_address
  );

  return query select true, inserted_review.id, inserted_review.reviewed_version_number, inserted_review.action;
end;
$$;

revoke all on function public.complete_document_upload_batch(uuid, uuid, integer, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_document_upload_batch(uuid, uuid, integer, uuid, jsonb, text) to service_role;

revoke all on function public.review_document_request(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.review_document_request(uuid, text, text, uuid, text) to service_role;
