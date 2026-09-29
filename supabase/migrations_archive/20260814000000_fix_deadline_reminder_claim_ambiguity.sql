-- Fix 42702 in claim_reminder_slot: RETURNS TABLE output names must not
-- shadow reminder_log columns used by the SQL queries.

create or replace function public.claim_reminder_slot(
  p_entity_type text,
  p_entity_id uuid,
  p_project_id uuid,
  p_recipient_id uuid,
  p_recipient_email text,
  p_recipient_kind text,
  p_threshold text,
  p_deadline_at timestamptz,
  p_source text,
  p_triggered_by uuid default null,
  p_run_id uuid default null
)
returns table (
  claimed boolean,
  log_id uuid,
  send_index integer,
  claim_token uuid,
  claim_expires_at timestamptz,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send_index integer;
  v_claimed_at timestamptz;
  v_expires_at timestamptz;
  v_token uuid := gen_random_uuid();
  v_log_id uuid;
begin
  if p_source not in ('cron', 'manual')
    or p_entity_type not in ('request', 'activity')
    or p_recipient_kind not in ('client', 'consultant')
    or p_threshold not in ('1_week', '3_days', '1_day', 'same_day', 'overdue')
    or p_recipient_id is null
    or p_recipient_email is null
    or btrim(p_recipient_email) = '' then
    raise exception 'invalid reminder claim';
  end if;

  if p_source = 'cron' and p_run_id is null then
    raise exception 'cron reminder claim requires run_id';
  end if;

  if p_source = 'manual' and p_triggered_by is null then
    raise exception 'manual reminder claim requires triggered_by';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        '%s:%s:%s:%s:%s',
        p_entity_type,
        p_entity_id,
        coalesce(p_recipient_id::text, ''),
        p_threshold,
        p_deadline_at::text
      ),
      0
    )
  );

  delete from public.reminder_log as rl
  where rl.entity_type = p_entity_type
    and rl.entity_id = p_entity_id
    and rl.recipient_id is not distinct from p_recipient_id
    and rl.threshold = p_threshold
    and rl.deadline_at = p_deadline_at
    and rl.status = 'claimed'
    and rl.claim_expires_at <= clock_timestamp();

  if exists (
    select 1
    from public.reminder_log as rl
    where rl.entity_type = p_entity_type
      and rl.entity_id = p_entity_id
      and rl.recipient_id is not distinct from p_recipient_id
      and rl.threshold = p_threshold
      and rl.deadline_at = p_deadline_at
      and rl.status = 'claimed'
  ) then
    return query select false, null::uuid, null::integer, null::uuid, null::timestamptz, 'in_progress'::text;
    return;
  end if;

  if p_source = 'cron' then
    if exists (
      select 1
      from public.reminder_log as rl
      where rl.entity_type = p_entity_type
        and rl.entity_id = p_entity_id
        and rl.recipient_id is not distinct from p_recipient_id
        and rl.threshold = p_threshold
        and rl.deadline_at = p_deadline_at
        and rl.send_index = 0
    ) then
      return query select false, null::uuid, null::integer, null::uuid, null::timestamptz, 'already_consumed'::text;
      return;
    end if;
    v_send_index := 0;
  else
    select coalesce(max(rl.send_index) + 1, 0)
      into v_send_index
    from public.reminder_log as rl
    where rl.entity_type = p_entity_type
      and rl.entity_id = p_entity_id
      and rl.recipient_id is not distinct from p_recipient_id
      and rl.threshold = p_threshold
      and rl.deadline_at = p_deadline_at;
  end if;

  v_claimed_at := clock_timestamp();
  v_expires_at := v_claimed_at + interval '15 minutes';

  insert into public.reminder_log (
    entity_type,
    entity_id,
    project_id,
    recipient_id,
    recipient_email,
    recipient_kind,
    threshold,
    deadline_at,
    status,
    source,
    triggered_by,
    run_id,
    send_index,
    claim_token,
    claimed_at,
    claim_expires_at
  )
  values (
    p_entity_type,
    p_entity_id,
    p_project_id,
    p_recipient_id,
    btrim(p_recipient_email),
    p_recipient_kind,
    p_threshold,
    p_deadline_at,
    'claimed',
    p_source,
    p_triggered_by,
    p_run_id,
    v_send_index,
    v_token,
    v_claimed_at,
    v_expires_at
  )
  returning id into v_log_id;

  return query select true, v_log_id, v_send_index, v_token, v_expires_at, 'claimed'::text;
end;
$$;

