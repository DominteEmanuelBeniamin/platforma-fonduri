-- Issue #78 follow-up: validate rejection notes before replay/status guards.
--
-- 20260821 is the applied #87 baseline. This forward-only migration carries
-- the #88 review delta without rewriting that historical migration: a rejected
-- review must fail with 400 even when the request is a replay or no longer in
-- the review status.

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

revoke all on function public.review_document_request(uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_document_request(uuid, text, text, uuid, text)
  to service_role;

do $verify$
begin
  if to_regprocedure('public.review_document_request(uuid,text,text,uuid,text)') is null then
    raise exception 'Review function was not installed';
  end if;
end;
$verify$;
*** Delete File: D:/work/platforma-fonduri/supabase/migrations/20260829000000_document_review_rejection_notes.sql
