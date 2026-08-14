-- Issue #71: jurnal pentru remindere automate și manuale.
-- Migrarea nu șterge coloanele legacy reminder_sent_at/reminder_type_sent.
-- Acestea vor fi eliminate doar după validarea backfill-ului și a codului nou.

create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),

  entity_type text not null,
  entity_id uuid not null,

  project_id uuid not null
    references public.projects(id)
    on delete cascade,

  recipient_id uuid
    references public.profiles(id)
    on delete set null,

  recipient_email text,
  recipient_kind text not null,

  threshold text not null,
  deadline_at timestamptz not null,

  status text not null,
  source text not null,

  triggered_by uuid
    references public.profiles(id)
    on delete set null,

  run_id uuid,
  provider_id text,

  send_index integer not null default 0,

  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,

  skip_reason text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,

  constraint reminder_log_entity_type_chk
    check (entity_type in ('request', 'activity')),

  constraint reminder_log_recipient_kind_chk
    check (recipient_kind in ('client', 'consultant')),

  constraint reminder_log_threshold_chk
    check (threshold in ('1_week', '3_days', '1_day', 'same_day', 'overdue')),

  constraint reminder_log_status_chk
    check (status in ('claimed', 'sent', 'skipped')),

  constraint reminder_log_source_chk
    check (source in ('cron', 'manual', 'legacy')),

  constraint reminder_log_send_index_chk
    check (send_index >= 0),

  constraint reminder_log_source_context_chk
    check (
      (source = 'cron' and run_id is not null and triggered_by is null)
      or
      (source = 'manual' and triggered_by is not null)
      or
      (source = 'legacy' and run_id is null and triggered_by is null)
    ),

  constraint reminder_log_recipient_email_chk
    check (
      recipient_email is not null
      or source = 'legacy'
    ),

  constraint reminder_log_state_chk
    check (
      (
        status = 'claimed'
        and sent_at is null
        and claim_token is not null
        and claimed_at is not null
        and claim_expires_at is not null
        and skip_reason is null
      )
      or
      (
        status = 'sent'
        and sent_at is not null
        and claim_token is null
        and claimed_at is null
        and claim_expires_at is null
        and skip_reason is null
      )
      or
      (
        status = 'skipped'
        and sent_at is null
        and provider_id is null
        and claim_token is null
        and claimed_at is null
        and claim_expires_at is null
        and skip_reason is not null
      )
    )
);

comment on table public.reminder_log is
  'Audit journal for automatic and manual deadline reminders.';

comment on column public.reminder_log.send_index is
  'Canonical first send uses 0; manual retries use 1, 2, ...';

comment on column public.reminder_log.status is
  'claimed is transient, sent means accepted by provider, skipped means consumed without email';

create unique index if not exists reminder_log_dedup_idx
  on public.reminder_log (
    entity_type,
    entity_id,
    recipient_id,
    threshold,
    deadline_at,
    send_index
  );

create index if not exists reminder_log_recipient_deadline_idx
  on public.reminder_log (recipient_id, deadline_at);

create index if not exists reminder_log_project_deadline_idx
  on public.reminder_log (project_id, deadline_at);

create index if not exists reminder_log_claim_expiry_idx
  on public.reminder_log (claim_expires_at)
  where status = 'claimed';

create index if not exists reminder_log_run_idx
  on public.reminder_log (run_id)
  where run_id is not null;

alter table public.reminder_log enable row level security;

-- Backfill pentru reminderele trimise înainte de jurnal.
-- Termenul curent este folosit intenționat: este preferabil să sărim un prag
-- decât să retrimitem un email către client.
with threshold_catalog(threshold, urgency_rank) as (
  values
    ('1_week', 1),
    ('3_days', 2),
    ('1_day', 3),
    ('same_day', 4),
    ('overdue', 5)
),
legacy as (
  select
    dr.id as entity_id,
    dr.project_id,
    p.id as recipient_id,
    p.email as recipient_email,
    dr.reminder_type_sent::text as sent_threshold,
    dr.deadline_at,
    dr.reminder_sent_at
  from public.document_requirements dr
  join public.projects pr
    on pr.id = dr.project_id
  left join public.profiles p
    on p.id = pr.client_id
  where dr.reminder_sent_at is not null
    and dr.deadline_at is not null
    and dr.reminder_type_sent::text in (
      '1_week',
      '3_days',
      '1_day',
      'same_day',
      'overdue'
    )
    and coalesce(dr.is_outgoing, false) = false
),
rows_to_insert as (
  select
    l.entity_id,
    l.project_id,
    l.recipient_id,
    l.recipient_email,
    'client'::text as recipient_kind,
    l.sent_threshold as threshold,
    'sent'::text as status,
    null::text as skip_reason,
    l.deadline_at,
    l.reminder_sent_at as event_at
  from legacy l

  union all

  select
    l.entity_id,
    l.project_id,
    l.recipient_id,
    l.recipient_email,
    'client'::text as recipient_kind,
    skipped.threshold,
    'skipped'::text as status,
    'legacy_backfill'::text as skip_reason,
    l.deadline_at,
    l.reminder_sent_at as event_at
  from legacy l
  join threshold_catalog sent
    on sent.threshold = l.sent_threshold
  join threshold_catalog skipped
    on skipped.urgency_rank < sent.urgency_rank
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
  provider_id,
  send_index,
  claim_token,
  claimed_at,
  claim_expires_at,
  skip_reason,
  created_at,
  sent_at
)
select
  'request',
  r.entity_id,
  r.project_id,
  r.recipient_id,
  r.recipient_email,
  r.recipient_kind,
  r.threshold,
  r.deadline_at,
  r.status,
  'legacy',
  null,
  null,
  null,
  0,
  null,
  null,
  null,
  r.skip_reason,
  r.event_at,
  case
    when r.status = 'sent' then r.event_at
    else null
  end
from rows_to_insert r
where not exists (
  select 1
  from public.reminder_log existing
  where existing.entity_type = 'request'
    and existing.entity_id = r.entity_id
    and existing.recipient_id is not distinct from r.recipient_id
    and existing.threshold = r.threshold
    and existing.deadline_at = r.deadline_at
    and existing.send_index = 0
);
