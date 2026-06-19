-- Server-side read state for project chat.
-- This makes project chat unread counts device-independent and usable outside
-- the project page, similar to private_conversation_participants.last_read_at.

create table if not exists public.project_chat_reads (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists idx_project_chat_reads_user_read
  on public.project_chat_reads (user_id, last_read_at);

create index if not exists idx_project_chat_reads_project_read
  on public.project_chat_reads (project_id, last_read_at);

create or replace function public.set_project_chat_reads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_project_chat_reads_updated_at on public.project_chat_reads;
create trigger trg_project_chat_reads_updated_at
  before update on public.project_chat_reads
  for each row execute function public.set_project_chat_reads_updated_at();

-- Backfill current clients and project members as read "now", so historical
-- messages do not become unread immediately after deploying this migration.
insert into public.project_chat_reads (project_id, user_id, last_read_at)
select p.id, p.client_id, now()
from public.projects p
where p.client_id is not null
on conflict (project_id, user_id) do nothing;

insert into public.project_chat_reads (project_id, user_id, last_read_at)
select pm.project_id, pm.consultant_id, now()
from public.project_members pm
where pm.consultant_id is not null
on conflict (project_id, user_id) do nothing;

-- If the DB has a project-level general consultant column, include it too.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'general_consultant_id'
  ) then
    execute '
      insert into public.project_chat_reads (project_id, user_id, last_read_at)
      select p.id, p.general_consultant_id, now()
      from public.projects p
      where p.general_consultant_id is not null
      on conflict (project_id, user_id) do nothing
    ';
  end if;
end;
$$;

create or replace function public.ensure_project_chat_read_for_project_client()
returns trigger
language plpgsql
as $$
begin
  if new.client_id is not null then
    insert into public.project_chat_reads (project_id, user_id, last_read_at)
    values (new.id, new.client_id, now())
    on conflict (project_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_chat_read_for_project_client on public.projects;
create trigger trg_project_chat_read_for_project_client
  after insert or update of client_id on public.projects
  for each row execute function public.ensure_project_chat_read_for_project_client();

create or replace function public.ensure_project_chat_read_for_project_member()
returns trigger
language plpgsql
as $$
begin
  if new.consultant_id is not null then
    insert into public.project_chat_reads (project_id, user_id, last_read_at)
    values (new.project_id, new.consultant_id, now())
    on conflict (project_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_chat_read_for_project_member on public.project_members;
create trigger trg_project_chat_read_for_project_member
  after insert or update of consultant_id on public.project_members
  for each row execute function public.ensure_project_chat_read_for_project_member();

-- Keep the author's read row current when they send a project message. This is
-- defensive: unread queries still ignore own messages, but receipts/read state
-- stay consistent even before the client calls mark-as-read.
create or replace function public.mark_project_chat_author_read()
returns trigger
language plpgsql
as $$
begin
  insert into public.project_chat_reads (project_id, user_id, last_read_at)
  values (new.project_id, new.created_by, new.created_at)
  on conflict (project_id, user_id) do update
    set last_read_at = greatest(
      coalesce(public.project_chat_reads.last_read_at, '-infinity'::timestamptz),
      excluded.last_read_at
    )
    where public.project_chat_reads.last_read_at is null
       or public.project_chat_reads.last_read_at < excluded.last_read_at;

  return new;
end;
$$;

drop trigger if exists trg_project_chat_author_read on public.project_chat_messages;
create trigger trg_project_chat_author_read
  after insert on public.project_chat_messages
  for each row execute function public.mark_project_chat_author_read();

-- Allow authenticated users to observe read rows for projects they can access.
-- Writes remain server-side through API routes using the service client.
create or replace function public.can_select_project_chat_read(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.profiles pr
      where pr.id = auth.uid()
        and pr.role = 'admin'
    )
    or exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.client_id = auth.uid()
    )
    or exists (
      select 1
      from public.project_members pm
      where pm.project_id = p_project_id
        and pm.consultant_id = auth.uid()
    );
$$;

alter table public.project_chat_reads enable row level security;

grant execute on function public.can_select_project_chat_read(uuid) to authenticated;
grant select on table public.project_chat_reads to authenticated;

drop policy if exists project_chat_reads_select_accessible_projects on public.project_chat_reads;
create policy project_chat_reads_select_accessible_projects
  on public.project_chat_reads
  for select
  to authenticated
  using (public.can_select_project_chat_read(project_id));

alter table public.project_chat_reads replica identity full;

do $$
begin
  if to_regclass('public.project_chat_messages') is not null then
    execute 'alter table public.project_chat_messages replica identity full';
  end if;
end;
$$;

-- Supabase Realtime needs tables in the supabase_realtime publication for
-- postgres_changes subscriptions. Keep this idempotent for environments where
-- the publication or membership already exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if to_regclass('public.project_chat_messages') is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'project_chat_messages'
      )
    then
      execute 'alter publication supabase_realtime add table public.project_chat_messages';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'project_chat_reads'
    )
    then
      execute 'alter publication supabase_realtime add table public.project_chat_reads';
    end if;
  end if;
end;
$$;
