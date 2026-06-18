-- Categoria cerinței de document: obligatoriu / dacă e cazul / opțional.
-- Înlocuiește semantic vechiul boolean is_mandatory, dar îl păstrăm și sincronizat
-- (prin trigger) pentru compatibilitate cu codul/rapoartele existente.

-- 1. Coloana pe tabelul de proiect și pe cel de template
alter table public.document_requirements
  add column if not exists requirement_type text;

alter table public.template_document_requirements
  add column if not exists requirement_type text;

-- 2. Backfill din is_mandatory (true -> obligatoriu, false/null -> optional)
update public.document_requirements
  set requirement_type = case when is_mandatory then 'obligatoriu' else 'optional' end
  where requirement_type is null;

update public.template_document_requirements
  set requirement_type = case when is_mandatory then 'obligatoriu' else 'optional' end
  where requirement_type is null;

-- 3. Constrângere de valori permise
alter table public.document_requirements
  drop constraint if exists document_requirements_requirement_type_check;
alter table public.document_requirements
  add constraint document_requirements_requirement_type_check
  check (requirement_type in ('obligatoriu', 'daca_e_cazul', 'optional'));

alter table public.template_document_requirements
  drop constraint if exists template_document_requirements_requirement_type_check;
alter table public.template_document_requirements
  add constraint template_document_requirements_requirement_type_check
  check (requirement_type in ('obligatoriu', 'daca_e_cazul', 'optional'));

-- 4. Trigger care menține is_mandatory <-> requirement_type sincronizate,
--    indiferent care dintre cele două coloane este scrisă de cod.
create or replace function public.sync_requirement_type()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.requirement_type is not null then
      new.is_mandatory := (new.requirement_type = 'obligatoriu');
    else
      new.requirement_type := case when new.is_mandatory then 'obligatoriu' else 'optional' end;
    end if;
  else -- UPDATE
    if new.requirement_type is distinct from old.requirement_type then
      new.is_mandatory := (new.requirement_type = 'obligatoriu');
    elsif new.is_mandatory is distinct from old.is_mandatory then
      new.requirement_type := case when new.is_mandatory then 'obligatoriu' else 'optional' end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_requirement_type on public.document_requirements;
create trigger trg_sync_requirement_type
  before insert or update on public.document_requirements
  for each row execute function public.sync_requirement_type();

drop trigger if exists trg_sync_requirement_type on public.template_document_requirements;
create trigger trg_sync_requirement_type
  before insert or update on public.template_document_requirements
  for each row execute function public.sync_requirement_type();

-- 5. Trigger-ul garantează valoarea => marcăm NOT NULL
alter table public.document_requirements
  alter column requirement_type set not null;
alter table public.template_document_requirements
  alter column requirement_type set not null;
