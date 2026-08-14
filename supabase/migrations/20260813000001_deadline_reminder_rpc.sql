-- Follow-up to 20260813000000_deadline_reminder_log.sql.
-- The table migration is already deployed; these functions keep claim/index
-- allocation inside one PostgreSQL transaction.

do $$
declare
  v_missing_deadline bigint;
begin
  select count(*)
    into v_missing_deadline
  from public.document_requirements
  where reminder_sent_at is not null
    and deadline_at is null;
  raise notice 'deadline reminder legacy rows without deadline_at: %', v_missing_deadline;
end;
$$;

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

  -- ponytail: one hashed advisory key per slot; replace with a keyed lock table
  -- only if hash collisions become measurable at production throughput.
  -- NULL recipient ids are compared as equal here, unlike a normal UNIQUE
  -- index. Active sends still require a concrete recipient id in application code.
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

  delete from public.reminder_log
  where entity_type = p_entity_type
    and entity_id = p_entity_id
    and recipient_id is not distinct from p_recipient_id
    and threshold = p_threshold
    and deadline_at = p_deadline_at
    and status = 'claimed'
    and claim_expires_at <= clock_timestamp();

  if exists (
    select 1
    from public.reminder_log
    where entity_type = p_entity_type
      and entity_id = p_entity_id
      and recipient_id is not distinct from p_recipient_id
      and threshold = p_threshold
      and deadline_at = p_deadline_at
      and status = 'claimed'
  ) then
    return query select false, null::uuid, null::integer, null::uuid, null::timestamptz, 'in_progress'::text;
    return;
  end if;

  if p_source = 'cron' then
    if exists (
      select 1
      from public.reminder_log
      where entity_type = p_entity_type
        and entity_id = p_entity_id
        and recipient_id is not distinct from p_recipient_id
        and threshold = p_threshold
        and deadline_at = p_deadline_at
        and send_index = 0
    ) then
      return query select false, null::uuid, null::integer, null::uuid, null::timestamptz, 'already_consumed'::text;
      return;
    end if;
    v_send_index := 0;
  else
    select coalesce(max(send_index) + 1, 0)
      into v_send_index
    from public.reminder_log
    where entity_type = p_entity_type
      and entity_id = p_entity_id
      and recipient_id is not distinct from p_recipient_id
      and threshold = p_threshold
      and deadline_at = p_deadline_at;
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

create or replace function public.finalize_reminder_claim(
  p_log_id uuid,
  p_claim_token uuid,
  p_provider_id text
)
returns table (
  finalized boolean,
  skipped_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.reminder_log%rowtype;
  v_skipped integer := 0;
begin
  select *
    into v_claim
  from public.reminder_log
  where id = p_log_id
    and status = 'claimed'
    and claim_token = p_claim_token
  for update;

  if not found then
    return query select false, 0;
  end if;

  update public.reminder_log
  set status = 'sent',
      provider_id = p_provider_id,
      sent_at = clock_timestamp(),
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null
  where id = v_claim.id;

  with thresholds(threshold, urgency_rank) as (
    values
      ('1_week', 1),
      ('3_days', 2),
      ('1_day', 3),
      ('same_day', 4),
      ('overdue', 5)
  )
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
    skip_reason,
    created_at
  )
  select
    v_claim.entity_type,
    v_claim.entity_id,
    v_claim.project_id,
    v_claim.recipient_id,
    v_claim.recipient_email,
    v_claim.recipient_kind,
    less.threshold,
    v_claim.deadline_at,
    'skipped',
    v_claim.source,
    v_claim.triggered_by,
    v_claim.run_id,
    0,
    'threshold_consumed',
    clock_timestamp()
  from thresholds sent
  join thresholds less on less.urgency_rank < sent.urgency_rank
  where sent.threshold = v_claim.threshold
  on conflict (entity_type, entity_id, recipient_id, threshold, deadline_at, send_index)
  do nothing;

  get diagnostics v_skipped = row_count;
  return query select true, v_skipped;
end;
$$;

create or replace function public.release_reminder_claim(
  p_log_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.reminder_log
  where id = p_log_id
    and status = 'claimed'
    and claim_token = p_claim_token;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.claim_reminder_slot(text, uuid, uuid, uuid, text, text, text, timestamptz, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_reminder_claim(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_reminder_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_reminder_slot(text, uuid, uuid, uuid, text, text, text, timestamptz, text, uuid, uuid) to service_role;
grant execute on function public.finalize_reminder_claim(uuid, uuid, text) to service_role;
grant execute on function public.release_reminder_claim(uuid, uuid) to service_role;

create index if not exists reminder_log_status_idx
  on public.reminder_log (entity_type, entity_id, status, threshold, deadline_at);
