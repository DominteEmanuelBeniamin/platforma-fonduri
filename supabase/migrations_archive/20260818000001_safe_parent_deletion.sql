-- Ștergere atomică pentru faze și activități.
-- Cererile active sunt mutate la „Cereri generale”; cererile soft-deleted sunt
-- doar detașate, pentru a permite ștergerea părintelui fără a le rescrie.

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
      assigned_to = coalesce(d.assigned_to, activity_assigned_to)
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
      assigned_to = coalesce(d.assigned_to, a.assigned_to)
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
