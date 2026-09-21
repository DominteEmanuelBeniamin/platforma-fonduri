alter table public.template_document_requirements
  add column if not exists is_outgoing boolean not null default false;
