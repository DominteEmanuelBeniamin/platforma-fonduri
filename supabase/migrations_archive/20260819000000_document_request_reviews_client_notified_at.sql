-- Issue #80: marcajul digestului pentru fiecare verificare a documentului.
alter table public.document_request_reviews
  add column if not exists client_notified_at timestamptz;

-- Verificările existente nu trebuie retrimise prin noul digest.
update public.document_request_reviews
set client_notified_at = now()
where client_notified_at is null;
