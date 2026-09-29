-- Issue #78 follow-up: code review fixes for the notification center.
--
-- 1. RLS and the unread summary share one security-definer visibility helper,
--    so the browser role never needs its own grants on document_requirements.
-- 2. Reading the badge and marking the panel read are single statements, not
--    unbounded paging loops inside the API routes.
-- 3. Assignment notifications get a deterministic event key, so the
--    UNIQUE (user_id, event_key) constraint actually deduplicates them.
-- 4. The upload batch unique index ignores soft-deleted files, exactly like
--    the duplicate probe inside complete_document_upload_batch already does.
-- 5. Notifications carry their own severity, so the UI stops deriving icon and
--    colour by matching Romanian titles.

-- ============================================================ severity

alter table public.notifications
  add column if not exists severity text not null default 'info';

do $severity_check$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_severity_check'
  ) then
    alter table public.notifications
      add constraint notifications_severity_check
      check (severity in ('info', 'success', 'warning', 'danger'));
  end if;
end;
$severity_check$;

-- One-time backfill for rows written before the column existed. Every row
-- inserted from here on arrives with its severity already set.
update public.notifications
set severity = case
  when type = 'deadline' and lower(title) like 'termen depășit%' then 'danger'
  when type = 'deadline' and lower(title) like 'termene depășite%' then 'danger'
  when type = 'deadline' then 'warning'
  when type = 'document_action' and lower(title) like 'document aprobat%' then 'success'
  when type = 'document_action' and lower(title) like 'document respins%' then 'danger'
  else 'info'
end
where severity = 'info';

-- ============================================================ visibility

-- One helper for every read path. The document_requirements probe used to be
-- inlined in the policy and ran with the caller's own privileges, unlike
-- can_select_project_chat_read right next to it.
create or replace function public.can_select_notification(
  p_project_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_select_project_chat_read(p_project_id)
    and (
      p_entity_type <> 'document_request'
      or exists (
        select 1
        from public.document_requirements dr
        where dr.id = p_entity_id
          and dr.project_id = p_project_id
          and dr.deleted_at is null
      )
    );
$$;

revoke all on function public.can_select_notification(uuid, text, uuid) from public, anon;
grant execute on function public.can_select_notification(uuid, text, uuid) to authenticated, service_role;

drop policy if exists notifications_select_own_accessible on public.notifications;
create policy notifications_select_own_accessible
  on public.notifications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and public.can_select_notification(project_id, entity_type, entity_id)
  );

-- ============================================================ badge + read

-- Counting happens in the database. The route used to page every unread row
-- into memory on each focus, tab return and realtime event.
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
      and public.can_select_notification(n.project_id, n.entity_type, n.entity_id)
    group by n.project_id
  ) totals;
$$;

revoke all on function public.notification_unread_summary() from public, anon;
grant execute on function public.notification_unread_summary() to authenticated, service_role;

-- Marking read is one UPDATE. The route used to select every visible id with
-- the user client and then update them in chunks with the service client.
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
    and (p_ids is null or n.id = any (p_ids))
    and public.can_select_notification(n.project_id, n.entity_type, n.entity_id);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;

-- ============================================================ upload batches

-- The probe inside complete_document_upload_batch counts only live rows, so
-- the index must ignore soft-deleted ones too. Otherwise a replayed batch
-- whose files were soft-deleted raises 23505 instead of returning idempotently.
drop index if exists public.files_requirement_upload_batch_storage_uidx;
create unique index files_requirement_upload_batch_storage_uidx
  on public.files(requirement_id, upload_batch_id, storage_path)
  where upload_batch_id is not null and deleted_at is null;

-- ============================================================ notification events

-- Recreated with p_severity. It defaults to 'info', so only the callers that
-- need another severity pass one.
drop function if exists public.insert_notification_event(
  uuid, text, text, uuid, text, integer, text, uuid, boolean, boolean, boolean
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
  p_severity text default 'info'
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
    severity
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
    p_severity
  from candidates
  where candidates.user_id is not null
  on conflict (user_id, event_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Assignment keys used to carry the current transaction id, which made them
-- unique per transaction and the unique constraint useless. Keying the
-- notification on the transition instead deduplicates a replayed assignment
-- while still notifying on a genuine change of assignee.
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
    'Activitate atribuită: ' || coalesce(new.name, new.id::text),
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
    true
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
    'Cerere de document atribuită: ' || coalesce(new.name, new.id::text),
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
    true
  );

  return new;
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
    'Document ' || case when p_action = 'approved' then 'aprobat' else 'respins' end ||
      ': "' || coalesce(requirement_row.name, p_request_id::text) || '"',
    1,
    'document-review:' || inserted_review.id::text,
    case when client_visible then project_client_id else null end,
    true,
    false,
    false,
    case when p_action = 'approved' then 'success' else 'danger' end
  );

  return query select true, inserted_review.id, inserted_review.reviewed_version_number, inserted_review.action;
end;
$$;

revoke all on function public.insert_notification_event(uuid, text, text, uuid, text, integer, text, uuid, boolean, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.insert_notification_event(uuid, text, text, uuid, text, integer, text, uuid, boolean, boolean, boolean, text)
  to service_role;

revoke all on function public.notify_project_activity_assignment()
  from public, anon, authenticated;
revoke all on function public.notify_document_request_assignment()
  from public, anon, authenticated;

revoke all on function public.review_document_request(uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_document_request(uuid, text, text, uuid, text)
  to service_role;

do $verify$
begin
  if to_regprocedure('public.can_select_notification(uuid,text,uuid)') is null
     or to_regprocedure('public.notification_unread_summary()') is null
     or to_regprocedure('public.mark_notifications_read(uuid[])') is null
     or to_regprocedure('public.insert_notification_event(uuid,text,text,uuid,text,integer,text,uuid,boolean,boolean,boolean,text)') is null then
    raise exception 'Notification center fix functions were not installed';
  end if;

  if to_regprocedure('public.insert_notification_event(uuid,text,text,uuid,text,integer,text,uuid,boolean,boolean,boolean)') is not null then
    raise exception 'The severity-less insert_notification_event overload is still present';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'files_requirement_upload_batch_storage_uidx'
      and indexdef like '%deleted_at IS NULL%'
  ) then
    raise exception 'files_requirement_upload_batch_storage_uidx does not exclude soft-deleted files';
  end if;
end;
$verify$;
