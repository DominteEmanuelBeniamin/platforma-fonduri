-- Issue #78 follow-up: the notification panel itself.
--
-- 1. A notification carries who caused it and what it is about, so a row reads
--    "Depunere cerere / Activitate atribuită de Ana" instead of the bare verb.
--    The assignment triggers cannot see the actor: the routes update through
--    the service client, where auth.uid() is null, so the actor travels with
--    the row it belongs to, in assigned_by.
-- 2. Dismissing is a soft delete. A hard delete would let any retry of the
--    same event_key (cron digest, replayed upload) resurrect a row the user
--    already closed, because UNIQUE (user_id, event_key) is the only thing
--    that stops the producers from writing it twice.
-- 3. Reading and unreading are explicit: the panel no longer marks everything
--    read behind the user's back, so "mark as unread" has to survive a close.

-- ============================================================ columns

alter table public.notifications
  add column if not exists dismissed_at timestamptz null;

alter table public.notifications
  add column if not exists actor_name text null;

alter table public.notifications
  add column if not exists entity_label text null;

-- Assignment happens in one UPDATE from a service-role route. Carrying the
-- actor on the row keeps the trigger's notification in the same transaction as
-- the change that caused it.
alter table public.project_activities
  add column if not exists assigned_by uuid null references public.profiles(id) on delete set null;

alter table public.document_requirements
  add column if not exists assigned_by uuid null references public.profiles(id) on delete set null;

-- Every read path filters dismissed rows out, so both indexes exclude them.
drop index if exists public.notifications_user_created_id_idx;
create index notifications_user_created_id_idx
  on public.notifications (user_id, created_at desc, id desc)
  where dismissed_at is null;

drop index if exists public.notifications_user_project_unread_idx;
create index notifications_user_project_unread_idx
  on public.notifications (user_id, project_id)
  where read_at is null and dismissed_at is null;

-- ============================================================ entity label

-- The producers that already know the name pass it; the rest would have to
-- repeat this lookup, each in its own dialect. A notification about a project
-- has no label of its own: the row already shows the project title.
create or replace function public.notification_entity_label(
  p_entity_type text,
  p_entity_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_entity_type
    when 'activity' then (
      select nullif(btrim(a.name), '') from public.project_activities a where a.id = p_entity_id
    )
    when 'phase' then (
      select nullif(btrim(ph.name), '') from public.project_phases ph where ph.id = p_entity_id
    )
    when 'document_request' then (
      select nullif(btrim(dr.name), '') from public.document_requirements dr where dr.id = p_entity_id
    )
    else null
  end;
$$;

revoke all on function public.notification_entity_label(text, uuid) from public, anon;
grant execute on function public.notification_entity_label(text, uuid) to authenticated, service_role;

-- ============================================================ badge + read state

-- Dismissed rows leave the badge with the row itself.
create or replace function public.notification_unread_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('projectId', totals.project_id, 'count', totals.unread_count)
      order by totals.project_id
    ),
    '[]'::jsonb
  )
  from (
    select n.project_id, count(*)::bigint as unread_count
    from public.notifications n
    where n.user_id = auth.uid()
      and n.read_at is null
      and n.dismissed_at is null
      and public.can_select_notification(n.project_id, n.entity_type, n.entity_id)
    group by n.project_id
  ) totals;
$$;

revoke all on function public.notification_unread_summary() from public, anon;
grant execute on function public.notification_unread_summary() to authenticated, service_role;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if p_ids is not null and coalesce(array_length(p_ids, 1), 0) > 500 then
    raise exception 'Too many notification ids' using errcode = 'P0001';
  end if;

  update public.notifications n
  set read_at = now()
  where n.user_id = auth.uid()
    and n.read_at is null
    and n.dismissed_at is null
    and (p_ids is null or n.id = any (p_ids))
    and public.can_select_notification(n.project_id, n.entity_type, n.entity_id);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;

-- Unreading is deliberately id-only. "Mark everything unread" is not a thing a
-- user asks for, and it would undo a decision the badge already reported.
create or replace function public.mark_notifications_unread(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;

  if array_length(p_ids, 1) > 500 then
    raise exception 'Too many notification ids' using errcode = 'P0001';
  end if;

  update public.notifications n
  set read_at = null
  where n.user_id = auth.uid()
    and n.read_at is not null
    and n.dismissed_at is null
    and n.id = any (p_ids)
    and public.can_select_notification(n.project_id, n.entity_type, n.entity_id);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_notifications_unread(uuid[]) from public, anon;
grant execute on function public.mark_notifications_unread(uuid[]) to authenticated, service_role;

-- Dismissing also reads the row: a badge that keeps counting something the
-- user has closed is a badge nobody can clear.
create or replace function public.dismiss_notifications(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;

  if array_length(p_ids, 1) > 500 then
    raise exception 'Too many notification ids' using errcode = 'P0001';
  end if;

  update public.notifications n
  set dismissed_at = now(),
      read_at = coalesce(n.read_at, now())
  where n.user_id = auth.uid()
    and n.dismissed_at is null
    and n.id = any (p_ids)
    and public.can_select_notification(n.project_id, n.entity_type, n.entity_id);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.dismiss_notifications(uuid[]) from public, anon;
grant execute on function public.dismiss_notifications(uuid[]) to authenticated, service_role;

-- ============================================================ notification events

drop function if exists public.insert_notification_event(
  uuid, text, text, uuid, text, integer, text, uuid, boolean, boolean, boolean, text
);

create or replace function public.insert_notification_event(
  p_project_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_item_count integer,
  p_event_key text,
  p_recipient_id uuid,
  p_include_admins boolean,
  p_fallback_to_project_members boolean,
  p_require_recipient boolean,
  p_severity text default 'info',
  p_actor_name text default null,
  p_entity_label text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_client_id uuid;
  notification_event_key text;
  explicit_eligible boolean := false;
  resolved_actor_name text;
  resolved_entity_label text;
  inserted_count integer;
begin
  if p_project_id is null
     or p_entity_id is null
     or p_type not in ('publication', 'assignment', 'deadline', 'document_action')
     or p_entity_type not in ('project', 'phase', 'activity', 'document_request')
     or nullif(btrim(p_title), '') is null
     or p_item_count is null
     or p_item_count < 1
     or nullif(btrim(p_event_key), '') is null
     or coalesce(p_severity, '') not in ('info', 'success', 'warning', 'danger') then
    raise exception 'Invalid notification event' using errcode = 'P0001';
  end if;

  select p.client_id
    into project_client_id
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'Notification project not found' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.project_members pm
    join public.profiles profile on profile.id = pm.consultant_id
    where pm.project_id = p_project_id
      and pm.consultant_id = p_recipient_id
      and profile.role = 'consultant'
      and profile.is_active is not false
  ) or exists (
    select 1
    from public.profiles profile
    where profile.id = p_recipient_id
      and profile.role = 'admin'
      and profile.is_active = true
  ) or exists (
    select 1
    from public.profiles profile
    where profile.id = p_recipient_id
      and profile.role = 'client'
      and profile.is_active is not false
      and profile.id = project_client_id
  )
    into explicit_eligible;

  if p_require_recipient and not explicit_eligible then
    raise exception 'Notification recipient is not eligible for this project'
      using errcode = 'P0001';
  end if;

  notification_event_key := btrim(p_event_key);
  resolved_actor_name := nullif(btrim(p_actor_name), '');
  -- A digest points at the project, and the project title is already on the row.
  resolved_entity_label := coalesce(
    nullif(btrim(p_entity_label), ''),
    public.notification_entity_label(p_entity_type, p_entity_id)
  );

  with candidates(user_id) as (
    select pm.consultant_id
    from public.project_members pm
    join public.profiles profile on profile.id = pm.consultant_id
    where profile.role = 'consultant'
      and profile.is_active is not false
      and (
        (p_recipient_id is not null and explicit_eligible and pm.consultant_id = p_recipient_id)
        or (
          p_fallback_to_project_members
          and (p_recipient_id is null or not explicit_eligible)
        )
      )
      and pm.project_id = p_project_id
    union
    select p_recipient_id
    from public.profiles profile
    where p_recipient_id is not null
      and profile.id = p_recipient_id
      and profile.role = 'client'
      and profile.is_active is not false
      and profile.id = project_client_id
    union
    select profile.id
    from public.profiles profile
    where p_include_admins
      and profile.role = 'admin'
      and profile.is_active = true
  )
  insert into public.notifications (
    user_id,
    project_id,
    type,
    entity_type,
    entity_id,
    title,
    item_count,
    event_key,
    severity,
    actor_name,
    entity_label
  )
  select distinct
    candidates.user_id,
    p_project_id,
    p_type,
    p_entity_type,
    p_entity_id,
    btrim(p_title),
    p_item_count,
    notification_event_key,
    p_severity,
    resolved_actor_name,
    resolved_entity_label
  from candidates
  where candidates.user_id is not null
  on conflict (user_id, event_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- ============================================================ producers

-- The name moves out of the title and into entity_label, so the panel can put
-- the subject on the first line and the action on the second, the same way for
-- every producer. Rows written before this keep their old title and render
-- from it unchanged.
create or replace function public.notify_project_activity_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_id uuid;
begin
  select p.project_id
    into project_id
  from public.project_phases p
  where p.id = new.phase_id;

  if not found then
    raise exception 'Project phase not found' using errcode = 'P0001';
  end if;

  perform public.insert_notification_event(
    project_id,
    'assignment',
    'activity',
    new.id,
    'Activitate atribuită',
    1,
    format(
      'assignment-v1:%s:%s:%s:%s',
      project_id,
      new.id,
      new.assigned_to,
      coalesce(old.assigned_to::text, 'none')
    ),
    new.assigned_to,
    true,
    false,
    true,
    'info',
    (
      select coalesce(nullif(btrim(actor.full_name), ''), actor.email)
      from public.profiles actor
      where actor.id = new.assigned_by
    ),
    coalesce(new.name, new.id::text)
  );

  return new;
end;
$$;

create or replace function public.notify_document_request_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.insert_notification_event(
    new.project_id,
    'assignment',
    'document_request',
    new.id,
    'Cerere de document atribuită',
    1,
    format(
      'assignment-v1:%s:%s:%s:%s',
      new.project_id,
      new.id,
      new.assigned_to,
      coalesce(old.assigned_to::text, 'none')
    ),
    new.assigned_to,
    true,
    false,
    true,
    'info',
    (
      select coalesce(nullif(btrim(actor.full_name), ''), actor.email)
      from public.profiles actor
      where actor.id = new.assigned_by
    ),
    coalesce(new.name, new.id::text)
  );

  return new;
end;
$$;

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
  activity_assigned_to uuid;
  general_consultant_id uuid;
  responsible_id uuid;
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

  perform public.insert_notification_event(
    requirement_row.project_id,
    'document_action',
    'document_request',
    p_requirement_id,
    case when requested_count = 1 then 'Document încărcat' else 'Documente încărcate' end,
    requested_count,
    'document-upload:' || p_upload_batch_id::text,
    responsible_id,
    true,
    true,
    false,
    'info',
    (
      select coalesce(nullif(btrim(uploader.full_name), ''), uploader.email)
      from public.profiles uploader
      where uploader.id = p_uploaded_by
    ),
    coalesce(requirement_row.name, p_requirement_id::text)
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
  activity_visibility text;
  activity_phase_id uuid;
  phase_visibility text;
  project_client_id uuid;
  client_visible boolean;
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

  if p_action = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'Notes are required for rejection' using errcode = 'P0001';
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

  select p.client_id
    into project_client_id
  from public.projects p
  where p.id = requirement_row.project_id;

  client_visible := requirement_row.visibility = 'published';
  if client_visible and requirement_row.activity_id is not null then
    select a.visibility, a.phase_id, p.visibility
      into activity_visibility, activity_phase_id, phase_visibility
    from public.project_activities a
    left join public.project_phases p on p.id = a.phase_id
    where a.id = requirement_row.activity_id
      and (a.phase_id is null or p.project_id = requirement_row.project_id);

    client_visible := found
      and activity_visibility = 'published'
      and (activity_phase_id is null or phase_visibility = 'published');
  end if;

  perform public.insert_notification_event(
    requirement_row.project_id,
    'document_action',
    'document_request',
    p_request_id,
    'Document ' || case when p_action = 'approved' then 'aprobat' else 'respins' end,
    1,
    'document-review:' || inserted_review.id::text,
    case when client_visible then project_client_id else null end,
    true,
    false,
    false,
    case when p_action = 'approved' then 'success' else 'danger' end,
    (
      select coalesce(nullif(btrim(reviewer.full_name), ''), reviewer.email)
      from public.profiles reviewer
      where reviewer.id = p_reviewed_by
    ),
    coalesce(requirement_row.name, p_request_id::text)
  );

  return query select true, inserted_review.id, inserted_review.reviewed_version_number, inserted_review.action;
end;
$$;

-- ============================================================ grants

revoke all on function public.insert_notification_event(uuid, text, text, uuid, text, integer, text, uuid, boolean, boolean, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.insert_notification_event(uuid, text, text, uuid, text, integer, text, uuid, boolean, boolean, boolean, text, text, text)
  to service_role;

revoke all on function public.notify_project_activity_assignment()
  from public, anon, authenticated;
revoke all on function public.notify_document_request_assignment()
  from public, anon, authenticated;

revoke all on function public.review_document_request(uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_document_request(uuid, text, text, uuid, text)
  to service_role;

revoke all on function public.complete_document_upload_batch(uuid, uuid, integer, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_document_upload_batch(uuid, uuid, integer, uuid, jsonb, text)
  to service_role;

do $verify$
begin
  if to_regprocedure('public.notification_entity_label(text,uuid)') is null
     or to_regprocedure('public.mark_notifications_unread(uuid[])') is null
     or to_regprocedure('public.dismiss_notifications(uuid[])') is null
     or to_regprocedure('public.insert_notification_event(uuid,text,text,uuid,text,integer,text,uuid,boolean,boolean,boolean,text,text,text)') is null then
    raise exception 'Notification panel functions were not installed';
  end if;

  if to_regprocedure('public.insert_notification_event(uuid,text,text,uuid,text,integer,text,uuid,boolean,boolean,boolean,text)') is not null then
    raise exception 'The actor-less insert_notification_event overload is still present';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications'
      and column_name in ('dismissed_at', 'actor_name', 'entity_label')
    having count(*) = 3
  ) then
    raise exception 'notifications is missing the panel columns';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_activities' and column_name = 'assigned_by'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'document_requirements' and column_name = 'assigned_by'
  ) then
    raise exception 'assigned_by was not added to both assignable tables';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'notifications_user_created_id_idx'
      and indexdef like '%dismissed_at IS NULL%'
  ) then
    raise exception 'notifications_user_created_id_idx does not exclude dismissed rows';
  end if;
end;
$verify$;
