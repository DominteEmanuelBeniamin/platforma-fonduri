-- Issue #78 follow-up: make project-member removal safe for assignments and
-- enforce one review per document-request version.

create or replace function public.remove_project_member_if_unassigned(
  p_project_id uuid,
  p_member_id uuid
)
returns table (
  removed boolean,
  consultant_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_general_consultant_id uuid;
  member_consultant_id uuid;
begin
  -- Lock the project first, then the membership and all assignment rows. This
  -- gives assignment updates a stable serialization point with this delete.
  select p.general_consultant_id
    into project_general_consultant_id
  from public.projects as p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  select pm.consultant_id
    into member_consultant_id
  from public.project_members as pm
  where pm.id = p_member_id
    and pm.project_id = p_project_id
  for update;

  if not found then
    raise exception 'Project member not found'
      using errcode = 'P0002';
  end if;

  perform a.id
  from public.project_activities as a
  join public.project_phases as ph on ph.id = a.phase_id
  where ph.project_id = p_project_id
  order by a.id
  for update;

  perform d.id
  from public.document_requirements as d
  where d.project_id = p_project_id
    and d.deleted_at is null
  order by d.id
  for update;

  if project_general_consultant_id = member_consultant_id then
    raise exception 'Cannot remove this consultant while they are the project general consultant. Reassign the project first.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.project_activities as a
    join public.project_phases as ph on ph.id = a.phase_id
    where ph.project_id = p_project_id
      and a.assigned_to = member_consultant_id
  ) then
    raise exception 'Cannot remove this consultant while they are assigned to an activity. Reassign the activity first.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.document_requirements as d
    where d.project_id = p_project_id
      and d.deleted_at is null
      and d.assigned_to = member_consultant_id
  ) then
    raise exception 'Cannot remove this consultant while they are assigned to an active document request. Reassign the request first.'
      using errcode = 'P0001';
  end if;

  delete from public.project_members as pm
  where pm.id = p_member_id
    and pm.project_id = p_project_id;

  if not found then
    raise exception 'Project member not found'
      using errcode = 'P0002';
  end if;

  return query select true, member_consultant_id;
end;
$$;

revoke all on function public.remove_project_member_if_unassigned(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_project_member_if_unassigned(uuid, uuid)
  to service_role;

-- Defense in depth for legacy assignments copied while deleting a parent.
create or replace function public.delete_project_activity_preserving_requests(
  project_id uuid,
  phase_id uuid,
  activity_id uuid
)
returns table (
  deleted boolean,
  moved_requests integer,
  demoted_requests integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  phase_visibility text;
  activity_visibility text;
  activity_assigned_to uuid;
  moved_count integer;
  demoted_count integer;
begin
  -- Lock the parent first so phase and activity deletion cannot deadlock.
  select p.visibility
    into phase_visibility
  from public.project_phases as p
  where p.id = $2
    and p.project_id = $1
  for update;

  if not found then
    raise exception 'Project phase not found'
      using errcode = 'P0002';
  end if;

  select a.visibility, a.assigned_to
    into activity_visibility, activity_assigned_to
  from public.project_activities as a
  where a.id = $3
    and a.phase_id = $2
  for update;

  if not found then
    raise exception 'Project activity not found'
      using errcode = 'P0002';
  end if;

  -- Lock the affected requests before counting so the returned summary matches
  -- the rows updated below, even when another write is in flight.
  perform d.id
  from public.document_requirements as d
  where d.project_id = $1
    and d.activity_id = $3
  order by d.id
  for update;

  select count(*)::integer
    into moved_count
  from public.document_requirements as d
  where d.project_id = $1
    and d.activity_id = $3
    and d.deleted_at is null;

  select count(*)::integer
    into demoted_count
  from public.document_requirements as d
  where d.project_id = $1
    and d.activity_id = $3
    and d.deleted_at is null
    and d.visibility = 'published'
    and (
      activity_visibility <> 'published'
      or phase_visibility <> 'published'
    );

  update public.document_requirements as d
  set activity_id = null,
      visibility = case
        when d.visibility = 'published'
          and activity_visibility = 'published'
          and phase_visibility = 'published'
          then 'published'
        else 'draft'
      end,
      assigned_to = case
        when d.assigned_to is not null then d.assigned_to
        when activity_assigned_to is not null
          and exists (
            select 1
            from public.project_members as pm
            join public.profiles as profile on profile.id = pm.consultant_id
            where pm.project_id = $1
              and pm.consultant_id = activity_assigned_to
              and profile.role = 'consultant'
              and profile.is_active is not false
          ) then activity_assigned_to
        else null
      end
  where d.project_id = $1
    and d.activity_id = $3
    and d.deleted_at is null;

  update public.document_requirements as d
  set activity_id = null
  where d.project_id = $1
    and d.activity_id = $3
    and d.deleted_at is not null;

  delete from public.project_activities as a
  where a.id = $3
    and a.phase_id = $2;

  return query
  select true, moved_count, demoted_count;
end;
$$;

create or replace function public.delete_project_phase_preserving_requests(
  project_id uuid,
  phase_id uuid
)
returns table (
  deleted boolean,
  deleted_activities integer,
  moved_requests integer,
  demoted_requests integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  phase_visibility text;
  deleted_activity_count integer;
  moved_count integer;
  demoted_count integer;
begin
  select p.visibility
    into phase_visibility
  from public.project_phases as p
  where p.id = $2
    and p.project_id = $1
  for update;

  if not found then
    raise exception 'Project phase not found'
      using errcode = 'P0002';
  end if;

  -- Lock children in a stable order, after locking their parent.
  perform a.id
  from public.project_activities as a
  where a.phase_id = $2
  order by a.id
  for update;

  perform d.id
  from public.document_requirements as d
  join public.project_activities as a on a.id = d.activity_id
  where d.project_id = $1
    and a.phase_id = $2
  order by d.id
  for update of d;

  select count(*)::integer
    into deleted_activity_count
  from public.project_activities as a
  where a.phase_id = $2;

  select count(*)::integer
    into moved_count
  from public.document_requirements as d
  join public.project_activities as a on a.id = d.activity_id
  where d.project_id = $1
    and a.phase_id = $2
    and d.deleted_at is null;

  select count(*)::integer
    into demoted_count
  from public.document_requirements as d
  join public.project_activities as a on a.id = d.activity_id
  where d.project_id = $1
    and a.phase_id = $2
    and d.deleted_at is null
    and d.visibility = 'published'
    and (
      a.visibility <> 'published'
      or phase_visibility <> 'published'
    );

  update public.document_requirements as d
  set activity_id = null,
      visibility = case
        when d.visibility = 'published'
          and a.visibility = 'published'
          and phase_visibility = 'published'
          then 'published'
        else 'draft'
      end,
      assigned_to = case
        when d.assigned_to is not null then d.assigned_to
        when a.assigned_to is not null
          and exists (
            select 1
            from public.project_members as pm
            join public.profiles as profile on profile.id = pm.consultant_id
            where pm.project_id = $1
              and pm.consultant_id = a.assigned_to
              and profile.role = 'consultant'
              and profile.is_active is not false
          ) then a.assigned_to
        else null
      end
  from public.project_activities as a
  where d.project_id = $1
    and d.activity_id = a.id
    and a.phase_id = $2
    and d.deleted_at is null;

  update public.document_requirements as d
  set activity_id = null
  from public.project_activities as a
  where d.project_id = $1
    and d.activity_id = a.id
    and a.phase_id = $2
    and d.deleted_at is not null;

  delete from public.project_activities as a
  where a.phase_id = $2;

  delete from public.project_phases as p
  where p.id = $2
    and p.project_id = $1;

  return query
  select true, deleted_activity_count, moved_count, demoted_count;
end;
$$;

revoke execute on function public.delete_project_activity_preserving_requests(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_project_activity_preserving_requests(uuid, uuid, uuid)
  to service_role;

revoke execute on function public.delete_project_phase_preserving_requests(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_project_phase_preserving_requests(uuid, uuid)
  to service_role;

-- Do not mutate historical reviews. If duplicates exist, stop and require a
-- deliberate/manual history decision before enforcing the invariant.
do $$
declare
  duplicate_group_count integer;
begin
  select count(*)::integer
    into duplicate_group_count
  from (
    select requirement_id, reviewed_version_number
    from public.document_request_reviews
    group by requirement_id, reviewed_version_number
    having count(*) > 1
  ) as duplicate_groups;

  raise notice 'Review uniqueness preflight found % duplicate key group(s)', duplicate_group_count;

  if duplicate_group_count > 0 then
    raise exception 'Cannot enforce review uniqueness: % historical duplicate key group(s) require manual resolution', duplicate_group_count
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists document_request_reviews_requirement_version_uidx
  on public.document_request_reviews(requirement_id, reviewed_version_number);

do $$
begin
  if to_regprocedure('public.remove_project_member_if_unassigned(uuid,uuid)') is null
     or to_regprocedure('public.delete_project_activity_preserving_requests(uuid,uuid,uuid)') is null
     or to_regprocedure('public.delete_project_phase_preserving_requests(uuid,uuid)') is null then
    raise exception 'Assignment integrity functions were not installed';
  end if;

  if to_regclass('public.document_request_reviews_requirement_version_uidx') is null then
    raise exception 'Review uniqueness index was not installed';
  end if;
end;
$$;
