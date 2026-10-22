-- Documente cu date sensibile: copii ale actelor de identitate (au CNP) și
-- caziere judiciare. Marcajul stă pe cererea din șablon și pe cea din proiect.
-- Jobul `/api/cron/date-sensibile` le șterge fișierele mai devreme decât restul
-- dosarului; aici se ține minte când a făcut-o și amânarea pusă de admin.
-- Termenele stau în `lib/sensitive-documents.ts`, nu în bază.

alter table public.template_document_requirements
  add column if not exists sensitive_kind text;

alter table public.template_document_requirements
  add constraint template_document_requirements_sensitive_kind_check
  check (sensitive_kind is null or sensitive_kind in ('identitate', 'cazier'));

comment on column public.template_document_requirements.sensitive_kind is
  'Date sensibile: identitate (copie act de identitate, cu CNP) sau cazier. Null = fără marcaj.';

alter table public.document_requirements
  add column if not exists sensitive_kind text,
  add column if not exists sensitive_hold_until timestamptz,
  add column if not exists sensitive_hold_reason text,
  add column if not exists sensitive_hold_by uuid references public.profiles(id) on delete set null,
  add column if not exists sensitive_purged_at timestamptz;

alter table public.document_requirements
  add constraint document_requirements_sensitive_kind_check
  check (sensitive_kind is null or sensitive_kind in ('identitate', 'cazier'));

-- Un document trimis clientului e al firmei, nu primește fișiere de la client.
alter table public.document_requirements
  add constraint document_requirements_sensitive_not_outgoing_check
  check (sensitive_kind is null or is_outgoing = false);

-- O amânare are mereu un motiv scris.
alter table public.document_requirements
  add constraint document_requirements_sensitive_hold_check
  check (
    (sensitive_hold_until is null and sensitive_hold_reason is null)
    or (sensitive_hold_until is not null and nullif(btrim(sensitive_hold_reason), '') is not null)
  );

comment on column public.document_requirements.sensitive_kind is
  'Date sensibile: identitate (copie act de identitate, cu CNP) sau cazier. Null = fără marcaj.';
comment on column public.document_requirements.sensitive_hold_until is
  'Ștergerea automată a fișierelor nu are loc înainte de această dată (amânare pusă de admin).';
comment on column public.document_requirements.sensitive_hold_reason is 'Motivul amânării, de exemplu un control în curs.';
comment on column public.document_requirements.sensitive_hold_by is 'Adminul care a pus amânarea.';
comment on column public.document_requirements.sensitive_purged_at is
  'Când a șters jobul fișierele cererii. După această dată cererea nu mai are fișiere.';

-- Jobul caută zilnic doar cererile marcate și încă neșterse.
create index if not exists idx_document_requirements_sensitive_pending
  on public.document_requirements (project_id)
  where sensitive_kind is not null and sensitive_purged_at is null;

-- Partea din bază a ștergerii automate. Ruta șterge întâi obiectele din
-- storage, apoi cheamă funcția: dacă se oprește între ele, următoarea rulare
-- reia tot, iar ștergerea din storage e idempotentă. Numele fișierelor și
-- căile lor conțin de obicei numele persoanei, deci se înlocuiesc și ele.
-- Jurnalul de audit rămâne neatins: e append-only.
create or replace function public.purge_sensitive_request_metadata(
  p_requirement_id uuid,
  p_purged_at timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_files integer;
begin
  update public.files
  set original_name = 'Document șters automat',
      storage_path = 'sters-automat/' || id::text,
      comments = null,
      deleted_at = coalesce(deleted_at, p_purged_at)
  where requirement_id = p_requirement_id
    and storage_path not like 'sters-automat/%';
  get diagnostics v_files = row_count;

  update public.document_upload_batches as batch
  set expected_files = (
    select jsonb_agg(
      (entries.item - 'original_name' - 'relative_path' - 'storage_path')
        || jsonb_build_object('original_name', 'Document șters automat', 'relative_path', null, 'storage_path', null)
      order by entries.ord
    )
    from jsonb_array_elements(batch.expected_files) with ordinality as entries(item, ord)
  )
  where batch.requirement_id = p_requirement_id;

  update public.document_requirements
  set sensitive_purged_at = p_purged_at
  where id = p_requirement_id
    and sensitive_kind is not null
    and sensitive_purged_at is null;

  return v_files;
end;
$function$;

revoke all on function public.purge_sensitive_request_metadata(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.purge_sensitive_request_metadata(uuid, timestamptz) to service_role;
