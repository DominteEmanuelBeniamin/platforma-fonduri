-- Global lease for the deadline-reminder cron. The lease is recoverable after
-- 15 minutes so a crashed invocation cannot block future runs permanently.

create table if not exists public.reminder_run_lease (
  lease_name text primary key,
  owner_id uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.reminder_run_lease enable row level security;

create or replace function public.acquire_reminder_run_lease(
  p_lease_name text,
  p_owner_id uuid,
  p_lease_seconds integer default 900
)
returns table (
  acquired boolean,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_lease_name), '') is null or p_owner_id is null then
    raise exception 'invalid reminder run lease';
  end if;

  if p_lease_seconds <= 0 then
    raise exception 'reminder run lease duration must be positive';
  end if;

  insert into public.reminder_run_lease (
    lease_name,
    owner_id,
    acquired_at,
    expires_at
  )
  values (
    p_lease_name,
    p_owner_id,
    clock_timestamp(),
    clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  on conflict (lease_name) do update
    set owner_id = excluded.owner_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where public.reminder_run_lease.expires_at <= clock_timestamp()
  returning true, public.reminder_run_lease.expires_at
  into acquired, expires_at;

  if found then
    return next;
    return;
  end if;

  return query
    select false, rl.expires_at
    from public.reminder_run_lease rl
    where rl.lease_name = p_lease_name;
end;
$$;

create or replace function public.release_reminder_run_lease(
  p_lease_name text,
  p_owner_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.reminder_run_lease
  where lease_name = p_lease_name
    and owner_id = p_owner_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.acquire_reminder_run_lease(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_reminder_run_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_reminder_run_lease(text, uuid, integer) to service_role;
grant execute on function public.release_reminder_run_lease(text, uuid) to service_role;
