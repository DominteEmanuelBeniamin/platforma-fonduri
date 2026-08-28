-- Issue #78 follow-up: două defecte ale notificărilor de atribuire.
--
-- 1. Cheia de eveniment a atribuirii era determinată numai de tranziția
--    `old.assigned_to -> new.assigned_to`. `UNIQUE (user_id, event_key)` nu
--    expiră, așa că o reatribuire a aceleiași persoane (A->B->A->B, sau
--    dezatribuire urmată de reatribuire) regenera o cheie deja existentă, iar
--    `on conflict do nothing` înghițea tăcut notificarea din clopoțel. Emailul
--    pleca oricum, fiindcă cheia lui de idempotență poartă versiunea rândului.
-- 2. RPC-urile de ștergere a fazei/activității moștenesc `assigned_to` de la
--    activitatea desființată. Scrierea aceea declanșa triggerul de atribuire:
--    consultantul primea „Cerere de document atribuită” pentru o cerere tocmai
--    retrogradată în draft și, fiindcă triggerul cere un destinatar eligibil,
--    un moștenitor care nu mai e membru al proiectului anula toată ștergerea.

-- ============================================================ versiune

-- Cheia de idempotență a emailului de atribuire trebuie să poarte o versiune a
-- rândului, ca la activități (`updated_at`). `document_requirements` nu avea
-- niciuna, așa că ruta o calcula în memorie și n-o scria nicăieri: două scrieri
-- concurente pe aceeași tranziție generau două chei, deci două emailuri.
-- Coloana asta e versiunea pe care o scrie ruta și pe care o citește înapoi ca
-- să construiască cheia.
alter table public.document_requirements
  add column if not exists assigned_at timestamptz;

comment on column public.document_requirements.assigned_at is
  'Momentul ultimei schimbări de `assigned_to`. Versiunea din cheia de idempotență a emailului de atribuire.';

-- ============================================================ suprimare

-- Steag tranzacțional, citit de triggerele de atribuire. Îl setează numai
-- scrierile care mută `assigned_to` fără ca cineva să fi atribuit ceva.
create or replace function public.assignment_notifications_suppressed()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('app.skip_assignment_notifications', true), 'off') = 'on';
$$;

-- ============================================================ producători

-- Cheia păstrează tranziția (două atribuiri diferite din aceeași tranzacție
-- rămân două notificări) și primește înapoi id-ul tranzacției, ca o atribuire
-- reală să nu fie confundată cu una veche. Dedublarea unui replay stă în
-- rutele de API, care scriu `assigned_to` sub o condiție optimistă pe valoarea
-- anterioară: o a doua încercare nu mai găsește rândul și întoarce 409, deci
-- nici nu ajunge la trigger.
create or replace function public.notify_project_activity_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_id uuid;
begin
  if public.assignment_notifications_suppressed() then
    return new;
  end if;

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
      'assignment-v2:%s:%s:%s:%s:%s',
      project_id,
      new.id,
      new.assigned_to,
      coalesce(old.assigned_to::text, 'none'),
      txid_current()
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
  if public.assignment_notifications_suppressed() then
    return new;
  end if;

  perform public.insert_notification_event(
    new.project_id,
    'assignment',
    'document_request',
    new.id,
    'Cerere de document atribuită',
    1,
    format(
      'assignment-v2:%s:%s:%s:%s:%s',
      new.project_id,
      new.id,
      new.assigned_to,
      coalesce(old.assigned_to::text, 'none'),
      txid_current()
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

-- ============================================================ ștergeri

-- Aceleași RPC-uri ca în 20260818000001, cu o singură schimbare: mutarea
-- cererilor la „Cereri generale” moștenește `assigned_to` de la activitatea
-- ștearsă cu triggerul de atribuire suprimat. Nimeni nu a atribuit nimic —
-- cererea tocmai și-a pierdut părintele — deci nu are cine să fie anunțat, iar
-- ștergerea nu mai depinde de eligibilitatea moștenitorului.
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

  perform set_config('app.skip_assignment_notifications', 'on', true);

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

  perform set_config('app.skip_assignment_notifications', 'off', true);

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

  perform set_config('app.skip_assignment_notifications', 'on', true);

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

  perform set_config('app.skip_assignment_notifications', 'off', true);

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

-- Triggerele care îl citesc sunt `security definer` și rulează ca proprietar,
-- deci nu au nevoie de acest grant. Rolul browserului nu are ce căuta aici.
revoke all on function public.assignment_notifications_suppressed()
  from public, anon, authenticated;
grant execute on function public.assignment_notifications_suppressed() to service_role;
