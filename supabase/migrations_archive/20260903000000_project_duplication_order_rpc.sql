-- Mutarea fraților după duplicarea unei faze/activități.
-- UPDATE-ul unic face operația atomică în PostgreSQL; copiile sunt create de
-- API înainte de apel, iar funcțiile sunt accesibile doar cu service_role.

create or replace function public.shift_project_phases_after_duplicate(
  p_project_id uuid,
  p_source_phase_id uuid,
  p_copy_phase_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_order integer;
begin
  if p_source_phase_id = p_copy_phase_id then
    raise exception 'Sursa și copia fazei trebuie să fie diferite';
  end if;

  select coalesce(order_index, 0)
    into source_order
  from public.project_phases
  where id = p_source_phase_id
    and project_id = p_project_id;

  if not found then
    raise exception 'Faza sursă nu aparține proiectului';
  end if;

  if not exists (
    select 1
    from public.project_phases
    where id = p_copy_phase_id
      and project_id = p_project_id
  ) then
    raise exception 'Copia fazei nu aparține proiectului';
  end if;

  update public.project_phases
  set order_index = order_index + 1
  where project_id = p_project_id
    and order_index > source_order
    and id <> p_copy_phase_id;
end;
$$;

create or replace function public.shift_project_activities_after_duplicate(
  p_phase_id uuid,
  p_source_activity_id uuid,
  p_copy_activity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_order integer;
begin
  if p_source_activity_id = p_copy_activity_id then
    raise exception 'Sursa și copia activității trebuie să fie diferite';
  end if;

  select coalesce(order_index, 0)
    into source_order
  from public.project_activities
  where id = p_source_activity_id
    and phase_id = p_phase_id;

  if not found then
    raise exception 'Activitatea sursă nu aparține fazei';
  end if;

  if not exists (
    select 1
    from public.project_activities
    where id = p_copy_activity_id
      and phase_id = p_phase_id
  ) then
    raise exception 'Copia activității nu aparține fazei';
  end if;

  update public.project_activities
  set order_index = order_index + 1
  where phase_id = p_phase_id
    and order_index > source_order
    and id <> p_copy_activity_id;
end;
$$;

revoke all on function public.shift_project_phases_after_duplicate(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.shift_project_phases_after_duplicate(uuid, uuid, uuid)
  to service_role;

revoke all on function public.shift_project_activities_after_duplicate(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.shift_project_activities_after_duplicate(uuid, uuid, uuid)
  to service_role;
