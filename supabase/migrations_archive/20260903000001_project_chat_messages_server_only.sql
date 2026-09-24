-- Keep raw project-chat messages server-only. Browser clients receive only the
-- redacted project_chat_events rows through Realtime and fetch message content
-- through the authorized API routes.

do $preconditions$
declare
  authenticated_oid oid;
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'project_chat_messages'
      and c.relkind in ('r', 'p')
  ) then
    raise exception 'Expected table public.project_chat_messages';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'project_chat_events'
      and c.relkind in ('r', 'p')
  ) then
    raise exception 'Expected table public.project_chat_events';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = to_regclass('public.project_chat_messages')
      and t.tgname = 'trg_project_chat_messages_emit_event'
      and not t.tgisinternal
      and t.tgenabled in ('O', 'A')
      and (t.tgtype & 1) <> 0
      and (t.tgtype & 2) = 0
      and (t.tgtype & 4) <> 0
      and (t.tgtype & 8) = 0
      and (t.tgtype & 16) <> 0
      and (t.tgtype & 32) = 0
      and n.nspname = 'public'
      and p.proname = 'project_chat_messages_emit_event'
  ) then
    raise exception
      'Expected enabled AFTER INSERT OR UPDATE trigger trg_project_chat_messages_emit_event';
  end if;

  if not exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.project_chat_events')
      and c.relrowsecurity
  ) then
    raise exception 'Expected RLS on public.project_chat_events';
  end if;

  select r.oid
    into authenticated_oid
  from pg_roles r
  where r.rolname = 'authenticated';

  if authenticated_oid is null then
    raise exception 'Expected database role authenticated';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'Expected database role anon';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Expected database role service_role';
  end if;

  if not exists (
    select 1
    from pg_policy p
    where p.polrelid = to_regclass('public.project_chat_events')
      and p.polname = 'project_chat_events_select_accessible_projects'
      and p.polcmd = 'r'
      and p.polpermissive
      and authenticated_oid = any (p.polroles)
      and p.polqual is not null
      and position(
        'can_select_project_chat_read(project_id)'
        in pg_get_expr(p.polqual, p.polrelid)
      ) > 0
  ) then
    raise exception
      'Expected authenticated SELECT policy project_chat_events_select_accessible_projects';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.project_chat_events',
    'SELECT'
  ) then
    raise exception 'Expected authenticated SELECT grant on public.project_chat_events';
  end if;

  if exists (
    select 1
    from pg_publication_namespace pn
    join pg_publication publication on publication.oid = pn.pnpubid
    join pg_namespace namespace on namespace.oid = pn.pnnspid
    where publication.pubname = 'supabase_realtime'
      and namespace.nspname = 'public'
  ) then
    raise exception
      'supabase_realtime publishes the entire public schema; raw messages cannot be excluded';
  end if;

  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
      and not puballtables
      and pubinsert
      and pubupdate
      and pubdelete
  ) then
    raise exception
      'Expected table-based supabase_realtime publication with INSERT/UPDATE/DELETE enabled';
  end if;

  if not exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.project_chat_events')
      and c.relreplident = 'f'
  ) then
    raise exception 'Expected REPLICA IDENTITY FULL on public.project_chat_events';
  end if;
end;
$preconditions$;

-- Table-level revokes do not remove grants made directly on individual
-- columns, so revoke both kinds before restoring the server role explicitly.
revoke all privileges on table public.project_chat_messages
  from public, anon, authenticated;

do $revoke_column_privileges$
declare
  column_list text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into column_list
  from pg_attribute a
  where a.attrelid = to_regclass('public.project_chat_messages')
    and a.attnum > 0
    and not a.attisdropped;

  if column_list is null then
    raise exception 'public.project_chat_messages has no columns';
  end if;

  execute format(
    'revoke all privileges (%s) on table public.project_chat_messages from public, anon, authenticated',
    column_list
  );
end;
$revoke_column_privileges$;

grant all privileges on table public.project_chat_messages to service_role;

-- The raw table must never be a Realtime source. Keep the redacted event table
-- published, repairing either publication membership idempotently.
do $realtime_publication$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_chat_messages'
  ) then
    alter publication supabase_realtime
      drop table public.project_chat_messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_chat_events'
  ) then
    alter publication supabase_realtime
      add table public.project_chat_events;
  end if;
end;
$realtime_publication$;

do $postconditions$
declare
  browser_role text;
  exposed_column text;
  table_privilege text;
  column_privilege text;
begin
  foreach browser_role in array array['anon', 'authenticated']
  loop
    -- has_*_privilege includes privileges inherited from PUBLIC or other roles,
    -- so these checks cover more than only the ACL entries revoked above.
    foreach table_privilege in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        browser_role,
        'public.project_chat_messages',
        table_privilege
      ) then
        raise exception
          'Role % still has table-level % on public.project_chat_messages',
          browser_role,
          table_privilege;
      end if;
    end loop;

    foreach column_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    loop
      exposed_column := null;
      select a.attname
        into exposed_column
      from pg_attribute a
      where a.attrelid = to_regclass('public.project_chat_messages')
        and a.attnum > 0
        and not a.attisdropped
        and has_column_privilege(
          browser_role,
          'public.project_chat_messages',
          a.attname,
          column_privilege
        )
      order by a.attnum
      limit 1;

      if exposed_column is not null then
        raise exception
          'Role % still has % on public.project_chat_messages column %',
          browser_role,
          column_privilege,
          exposed_column;
      end if;
    end loop;
  end loop;

  foreach table_privilege in array array[
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER'
  ]
  loop
    if not has_table_privilege(
      'service_role',
      'public.project_chat_messages',
      table_privilege
    ) then
      raise exception
        'service_role is missing % on public.project_chat_messages',
        table_privilege;
    end if;
  end loop;

  if (
    select c.relrowsecurity
    from pg_class c
    where c.oid = to_regclass('public.project_chat_messages')
  ) and not coalesce((
    select r.rolbypassrls
    from pg_roles r
    where r.rolname = 'service_role'
  ), false) then
    raise exception
      'service_role must bypass RLS on public.project_chat_messages';
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_chat_messages'
  ) then
    raise exception
      'public.project_chat_messages is still published through supabase_realtime';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_chat_events'
  ) then
    raise exception
      'public.project_chat_events is not published through supabase_realtime';
  end if;

  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
      and not puballtables
      and pubinsert
      and pubupdate
      and pubdelete
  ) then
    raise exception
      'supabase_realtime no longer publishes INSERT/UPDATE/DELETE';
  end if;

  if exists (
    select 1
    from pg_publication_namespace pn
    join pg_publication publication on publication.oid = pn.pnpubid
    join pg_namespace namespace on namespace.oid = pn.pnnspid
    where publication.pubname = 'supabase_realtime'
      and namespace.nspname = 'public'
  ) then
    raise exception
      'supabase_realtime publishes the entire public schema';
  end if;

  if not exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.project_chat_events')
      and c.relreplident = 'f'
  ) then
    raise exception
      'public.project_chat_events no longer has REPLICA IDENTITY FULL';
  end if;
end;
$postconditions$;
