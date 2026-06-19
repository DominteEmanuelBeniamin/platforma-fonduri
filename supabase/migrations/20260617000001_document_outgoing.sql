-- Documente trimise de consultant CĂTRE client (informative), nu cerute de la client.
-- is_outgoing = true  -> document pe care clientul doar îl descarcă (fără upload înapoi).
-- is_outgoing = false -> cerere normală de document (comportamentul existent).
alter table public.document_requirements
  add column if not exists is_outgoing boolean not null default false;
