-- Server-owned upload manifests.  A manifest reserves paths, not a version;
-- the version is allocated atomically when the manifest is completed.
create table public.document_upload_batches (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.document_requirements(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  expected_files jsonb not null,
  completed_file_ids jsonb null,
  version_number integer null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint document_upload_batches_expected_files_check
    check (jsonb_typeof(expected_files) = 'array' and jsonb_array_length(expected_files) between 1 and 50),
  constraint document_upload_batches_completed_file_ids_check
    check (completed_file_ids is null or jsonb_typeof(completed_file_ids) = 'array'),
  constraint document_upload_batches_version_check
    check (version_number is null or version_number > 0),
  constraint document_upload_batches_requirement_version_key
    unique (requirement_id, version_number)
);

alter table public.document_upload_batches enable row level security;
revoke all on table public.document_upload_batches from public, anon, authenticated;
grant all on table public.document_upload_batches to service_role;

create or replace function public.complete_reserved_document_upload_batch(
  p_upload_batch_id uuid,
  p_actor_id uuid,
  p_selected_file_ids jsonb,
  p_ip_address text default null
)
returns table(created boolean, version_number integer, file_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  batch_row public.document_upload_batches%rowtype;
  requirement_row public.document_requirements%rowtype;
  normalized_file_ids jsonb;
  requested_count integer;
  inserted_count integer;
  next_version integer;
  profile_email text;
  project_title text;
  file_names text;
  activity_assigned_to uuid;
  general_consultant_id uuid;
  responsible_id uuid;
begin
  if p_upload_batch_id is null
     or p_actor_id is null
     or coalesce(jsonb_typeof(p_selected_file_ids), '') <> 'array'
     or jsonb_array_length(p_selected_file_ids) < 1
     or jsonb_array_length(p_selected_file_ids) > 50 then
    raise exception 'Invalid document upload batch' using errcode = 'P0001';
  end if;

  requested_count := jsonb_array_length(p_selected_file_ids);

  if exists (
    select 1
    from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id)
    group by selected.file_id
    having count(*) > 1
  ) then
    raise exception 'Upload batch contains duplicate file ids' using errcode = 'P0001';
  end if;

  select *
    into batch_row
  from public.document_upload_batches
  where id = p_upload_batch_id
  for update;

  if not found then
    raise exception 'Document upload batch not found' using errcode = 'P0001';
  end if;

  if batch_row.uploaded_by <> p_actor_id then
    raise exception 'Document upload batch actor mismatch' using errcode = 'P0001';
  end if;

  select *
    into requirement_row
  from public.document_requirements
  where id = batch_row.requirement_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Document request not found' using errcode = 'P0001';
  end if;

  if requirement_row.is_outgoing then
    raise exception 'Outgoing document requests do not accept uploads' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id)
    where not exists (
      select 1
      from jsonb_array_elements(batch_row.expected_files) as expected(file_data)
      where expected.file_data->>'file_id' = selected.file_id
    )
  ) then
    raise exception 'Upload batch contains an unknown file id' using errcode = 'P0001';
  end if;

  select jsonb_agg(to_jsonb(selected.file_id) order by selected.file_id)
    into normalized_file_ids
  from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id);

  if batch_row.version_number is not null then
    if batch_row.completed_file_ids = normalized_file_ids then
      return query select false, batch_row.version_number, requested_count;
      return;
    end if;
    raise exception 'Upload batch already completed with a different file set' using errcode = 'P0001';
  end if;

  -- The requirement row lock serializes all completing batches for this request.
  select coalesce(max(f.version_number), 0) + 1
    into next_version
  from public.files as f
  where f.requirement_id = batch_row.requirement_id;

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
    batch_row.requirement_id,
    batch_row.id,
    expected.file_data->>'storage_path',
    expected.file_data->>'original_name',
    nullif(expected.file_data->>'mime_type', ''),
    (expected.file_data->>'declared_size')::bigint,
    next_version,
    p_actor_id
  from jsonb_array_elements(batch_row.expected_files) as expected(file_data)
  where expected.file_data->>'file_id' in (
    select selected.file_id
    from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id)
  );

  get diagnostics inserted_count = row_count;
  if inserted_count <> requested_count then
    raise exception 'Document upload batch was not inserted completely' using errcode = 'P0001';
  end if;

  update public.document_upload_batches
  set completed_file_ids = normalized_file_ids,
      version_number = next_version,
      completed_at = now()
  where id = batch_row.id;

  update public.document_requirements
  set status = 'review'
  where id = requirement_row.id
    and deleted_at is null;

  if not found then
    raise exception 'Document request disappeared during upload' using errcode = 'P0001';
  end if;

  select p.email
    into profile_email
  from public.profiles p
  where p.id = p_actor_id;

  select p.title, p.general_consultant_id
    into project_title, general_consultant_id
  from public.projects p
  where p.id = requirement_row.project_id;

  if requirement_row.activity_id is not null then
    select a.assigned_to
      into activity_assigned_to
    from public.project_activities a
    where a.id = requirement_row.activity_id;
  end if;

  responsible_id := coalesce(requirement_row.assigned_to, activity_assigned_to, general_consultant_id);

  select string_agg(expected.file_data->>'original_name', ', ' order by expected.file_data->>'file_id')
    into file_names
  from jsonb_array_elements(batch_row.expected_files) as expected(file_data)
  where expected.file_data->>'file_id' in (
    select selected.file_id
    from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id)
  );

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
    p_actor_id,
    'create',
    'file',
    requirement_row.id,
    requirement_row.name,
    jsonb_build_object(
      'requirement_id', requirement_row.id,
      'requirement_name', requirement_row.name,
      'project_id', requirement_row.project_id,
      'project_title', project_title,
      'file_count', requested_count,
      'version', next_version,
      'files', file_names,
      'upload_batch_id', batch_row.id
    ),
    coalesce(profile_email, 'User') || ' a încărcat ' || requested_count ||
      ' fișier(e) pentru cererea "' || coalesce(requirement_row.name, requirement_row.id::text) ||
      '" din proiectul "' || coalesce(project_title, requirement_row.project_id::text) || '"',
    p_ip_address
  );

  perform public.insert_notification_event(
    requirement_row.project_id,
    'document_action',
    'document_request',
    requirement_row.id,
    case when requested_count = 1
      then 'Document încărcat pentru cererea "' || coalesce(requirement_row.name, requirement_row.id::text) || '"'
      else 'Documente încărcate pentru cererea "' || coalesce(requirement_row.name, requirement_row.id::text) || '"'
    end,
    requested_count,
    'document-upload:' || batch_row.id::text,
    responsible_id,
    true,
    true,
    false
  );

  return query select true, next_version, inserted_count;
end;
$$;

revoke all on function public.complete_reserved_document_upload_batch(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_reserved_document_upload_batch(uuid, uuid, jsonb, text)
  to service_role;
