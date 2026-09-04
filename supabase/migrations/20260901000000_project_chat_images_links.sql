-- Store private project-chat image metadata and publish only redacted events.
alter table public.project_chat_messages
  add column if not exists images jsonb not null default '[]'::jsonb;

alter table public.project_chat_messages
  alter column body drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project_chat_messages'::regclass
      and conname = 'project_chat_messages_images_array_max'
  ) then
    alter table public.project_chat_messages
      add constraint project_chat_messages_images_array_max
      check (
        jsonb_typeof(images) = 'array'
        and jsonb_array_length(case
          when jsonb_typeof(images) = 'array' then images
          else '[]'::jsonb
        end) <= 5
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project_chat_messages'::regclass
      and conname = 'project_chat_messages_body_or_images'
  ) then
    alter table public.project_chat_messages
      add constraint project_chat_messages_body_or_images
      check (
        nullif(btrim(body), '') is not null
        or (
          jsonb_typeof(images) = 'array'
          and jsonb_array_length(case
            when jsonb_typeof(images) = 'array' then images
            else '[]'::jsonb
          end) > 0
        )
      );
  end if;
end;
$$;

create table if not exists public.project_chat_events (
  message_id uuid primary key references public.project_chat_messages(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'updated', 'deleted')),
  changed_at timestamptz not null default now()
);

create index if not exists idx_project_chat_events_project_changed
  on public.project_chat_events (project_id, changed_at desc);

create or replace function public.project_chat_messages_emit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_event_type text;
begin
  if tg_op = 'INSERT' then
    next_event_type := case when new.deleted_at is null then 'created' else 'deleted' end;
  elsif old.deleted_at is null and new.deleted_at is not null then
    next_event_type := 'deleted';
  else
    next_event_type := 'updated';
  end if;

  insert into public.project_chat_events (message_id, project_id, event_type, changed_at)
  values (new.id, new.project_id, next_event_type, now())
  on conflict (message_id) do update
    set project_id = excluded.project_id,
        event_type = excluded.event_type,
        changed_at = excluded.changed_at;

  return new;
end;
$$;

drop trigger if exists trg_project_chat_messages_emit_event on public.project_chat_messages;
create trigger trg_project_chat_messages_emit_event
  after insert or update on public.project_chat_messages
  for each row execute function public.project_chat_messages_emit_event();

alter table public.project_chat_events enable row level security;

drop policy if exists project_chat_events_select_accessible_projects on public.project_chat_events;
create policy project_chat_events_select_accessible_projects
  on public.project_chat_events
  for select
  to authenticated
  using (public.can_select_project_chat_read(project_id));

grant select on table public.project_chat_events to authenticated;
alter table public.project_chat_events replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'project_chat_messages'
    ) then
      execute 'alter publication supabase_realtime drop table public.project_chat_messages';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'project_chat_events'
    ) then
      execute 'alter publication supabase_realtime add table public.project_chat_events';
    end if;
  end if;
end;
$$;
