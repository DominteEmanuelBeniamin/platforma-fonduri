-- Issue #63: digest de notificare client la publicare (#7 + #8).
-- null = element publicat, neanuntat inca; timestamp = inclus intr-un digest trimis cu succes.
alter table public.project_phases
  add column if not exists client_notified_at timestamptz;

alter table public.project_activities
  add column if not exists client_notified_at timestamptz;

alter table public.document_requirements
  add column if not exists client_notified_at timestamptz;
