-- Helps the global unread endpoint and project chat list stay cheap as the
-- project_chat_messages table grows.

create index if not exists idx_project_chat_messages_unread_lookup
  on public.project_chat_messages (project_id, created_at desc)
  include (created_by)
  where deleted_at is null;
