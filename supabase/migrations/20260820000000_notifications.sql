-- Issue #78, Faza 1: replace the empty legacy notification table.

-- Do not replace an unknown table or discard historical rows accidentally.
do $$
declare
  legacy_columns text[];
  has_rows boolean;
begin
  if to_regclass('public.notifications') is null then
    raise exception
      'Expected empty legacy table public.notifications before Issue #78 migration';
  end if;

  select array_agg(column_name order by column_name)
    into legacy_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'notifications';

  if legacy_columns is distinct from array[
    'created_at',
    'entity_id',
    'entity_type',
    'id',
    'is_read',
    'message',
    'priority',
    'read_at',
    'title',
    'type',
    'user_id'
  ]::text[] then
    raise exception
      'public.notifications is not the expected legacy schema: %',
      coalesce(array_to_string(legacy_columns, ', '), '<missing>');
  end if;

  execute 'select exists (select 1 from public.notifications)'
    into has_rows;

  if has_rows then
    raise exception
      'public.notifications is not empty; aborting Issue #78 migration';
  end if;
end;
$$;

-- Drop every discovered overload by its exact identity signature. RESTRICT
-- intentionally makes unknown database dependencies stop this migration.
do $$
declare
  notification_function record;
begin
  for notification_function in
    select pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_notification'
  loop
    execute format(
      'drop function public.create_notification(%s) restrict',
      notification_function.identity_arguments
    );
  end loop;
end;
$$;

drop table public.notifications restrict;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('publication', 'assignment', 'deadline', 'document_action')),
  entity_type text not null check (entity_type in ('project', 'phase', 'activity', 'document_request')),
  entity_id uuid not null,
  title text not null,
  item_count integer not null default 1 check (item_count > 0),
  event_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  constraint notifications_user_event_key_key unique (user_id, event_key)
);

create index notifications_user_created_id_idx
  on public.notifications (user_id, created_at desc, id desc);

create index notifications_user_project_unread_idx
  on public.notifications (user_id, project_id)
  where read_at is null;

alter table public.notifications enable row level security;
alter table public.notifications replica identity full;

revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;

create policy notifications_select_own_accessible
  on public.notifications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and public.can_select_project_chat_read(project_id)
    and (
      entity_type <> 'document_request'
      or exists (
        select 1
        from public.document_requirements dr
        where dr.id = public.notifications.entity_id
          and dr.project_id = public.notifications.project_id
          and dr.deleted_at is null
      )
    )
  );

-- Keep postgres_changes subscriptions idempotent across environments where
-- Supabase already added the table to the publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$$;
