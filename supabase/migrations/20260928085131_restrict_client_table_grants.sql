revoke all on table
  public.audit_logs,
  public.document_upload_batches,
  public.notifications,
  public.project_chat_messages
from anon, authenticated;

grant select on table public.notifications to authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
