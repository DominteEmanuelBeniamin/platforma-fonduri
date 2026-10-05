-- Încheierea proiectului, finalizarea fazelor și activităților, închiderea
-- cererilor de documente (issue #109).
--
-- Tranzițiile se fac doar prin rutele dedicate din app/api (service_role),
-- cu update condiționat pe starea curentă și cu audit. Aici stau invariantele
-- pe care niciun drum, vechi sau viitor, nu le poate ocoli.
--
-- Verificat în producție pe 5 octombrie 2026, înainte de migrare: niciun
-- proiect cu `lifecycle_status` NULL, nicio fază sau activitate cu `completed_at`
-- inconsecvent, nicio cerere cu `status` NULL. Backfill-urile de mai jos sunt
-- plasă de siguranță pentru alte baze (locală, preview), nu corecturi de date.

-- ─── 1. Proiecte ─────────────────────────────────────────────────────────────

-- Cronul de remindere trece pe `lifecycle_status = 'active'`: un NULL ar opri
-- tăcut reminderele proiectului, deci coloana devine obligatorie.
update public.projects set lifecycle_status = 'active' where lifecycle_status is null;
alter table public.projects alter column lifecycle_status set not null;

alter table public.projects
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null;

update public.projects
set closed_at = coalesce(updated_at, now())
where lifecycle_status = 'completed' and closed_at is null;

-- Încheiat ⇔ are dată de încheiere. Autorul poate lipsi (cont șters), dar nu
-- poate exista fără dată.
alter table public.projects
  add constraint projects_closed_consistency
  check (
    (lifecycle_status = 'completed') = (closed_at is not null)
    and (closed_by is null or closed_at is not null)
  );

comment on column public.projects.closed_at is 'Când a fost încheiat proiectul (lifecycle_status = completed). Golit la redeschidere.';
comment on column public.projects.closed_by is 'Cine a încheiat proiectul. Golit la redeschidere.';

-- ─── 2. Faze și activități ───────────────────────────────────────────────────

-- Curățarea inconsecvențelor, apoi invariantul. Fazele n-au `updated_at`, deci
-- data de finalizare lipsă se completează cu momentul migrării.
update public.project_phases
set completed_at = null, completed_by = null
where status <> 'completed' and (completed_at is not null or completed_by is not null);

update public.project_phases
set completed_at = now()
where status = 'completed' and completed_at is null;

update public.project_activities
set completed_at = null, completed_by = null
where status <> 'completed' and (completed_at is not null or completed_by is not null);

update public.project_activities
set completed_at = coalesce(updated_at, now())
where status = 'completed' and completed_at is null;

alter table public.project_phases
  add constraint project_phases_completed_consistency
  check (
    (status = 'completed') = (completed_at is not null)
    and (completed_by is null or completed_at is not null)
  );

alter table public.project_activities
  add constraint project_activities_completed_consistency
  check (
    (status = 'completed') = (completed_at is not null)
    and (completed_by is null or completed_at is not null)
  );

-- ─── 3. Cereri de documente ──────────────────────────────────────────────────

update public.document_requirements set status = 'pending' where status is null;
alter table public.document_requirements alter column status set not null;

-- `closed` e o stare nouă, separată de `approved`: toate filtrele „e ceva de
-- făcut aici" lucrează pe liste de stări permise, deci o cerere închisă iese
-- singură din remindere, din „Ce ai de făcut" și din butoanele de încărcare.
alter table public.document_requirements drop constraint if exists document_requirements_status_check;
alter table public.document_requirements
  add constraint document_requirements_status_check
  check (status = any (array['pending', 'review', 'approved', 'rejected', 'closed']));

-- `status_before_close` e starea la care revine cererea la redeschidere. Se
-- închid doar cererile „De încărcat" și „Respins"; una în verificare se verifică
-- întâi (decizia D3).
alter table public.document_requirements
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists status_before_close text;

alter table public.document_requirements
  add constraint document_requirements_status_before_close_check
  check (status_before_close in ('pending', 'rejected'));

-- Închisă ⇔ dată ⇔ stare de revenire. Documentele trimise clientului nu se
-- închid niciodată (D12).
alter table public.document_requirements
  add constraint document_requirements_closed_consistency
  check (
    (status = 'closed') = (closed_at is not null)
    and (status = 'closed') = (status_before_close is not null)
    and (closed_by is null or closed_at is not null)
    and not (is_outgoing and status = 'closed')
  );

comment on column public.document_requirements.closed_at is 'Când a fost închisă cererea (status = closed). Golit la redeschidere.';
comment on column public.document_requirements.closed_by is 'Cine a închis cererea. Golit la redeschidere.';
comment on column public.document_requirements.status_before_close is 'Starea la care revine cererea la redeschidere: pending sau rejected.';

-- ─── 4. Garda la încărcare ───────────────────────────────────────────────────

-- `complete_reserved_document_upload_batch` pune cererea în `review` fără nicio
-- condiție. Fără gardă, o încărcare într-o cerere închisă ar redeschide-o pe
-- ascuns. Excepția anulează toată tranzacția funcției, inclusiv rândurile din
-- `files`, deci nu rămâne nimic pe jumătate scris. Rutele de încărcare verifică
-- și ele starea, înainte; triggerul acoperă orice drum care le ocolește.
create or replace function public.prevent_upload_into_closed_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status = 'review' then
    raise exception 'Document request is closed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_upload_into_closed_request on public.document_requirements;
create trigger trg_prevent_upload_into_closed_request
  before update of status on public.document_requirements
  for each row execute function public.prevent_upload_into_closed_request();

-- ─── 5. Securitate ───────────────────────────────────────────────────────────

-- Funcții vechi, nefolosite de aplicație, SECURITY DEFINER și executabile de
-- `anon`/`authenticated`. `revert_project_phase` ar fi redeschis un proiect
-- încheiat ocolind auditul.
drop function if exists public.advance_project_phase(uuid, boolean);
drop function if exists public.revert_project_phase(uuid, text);

-- Orice consultant membru, inclusiv juniorul, putea scrie direct prin PostgREST
-- în faze și activități, ocolind rutele, regulile de drepturi (D1) și auditul,
-- iar `completed_by` se putea falsifica. Aplicația scrie doar prin service_role
-- (verificat: niciun `.from()` în afara app/api). Același tratament ca la
-- `document_requirements` în 20260921000001. SELECT rămâne: funcțiile RLS ale
-- chatului de proiect citesc fazele și activitățile.
drop policy if exists "phases_consultant_update" on public.project_phases;
drop policy if exists "activities_consultant_update" on public.project_activities;

revoke insert, update, delete, truncate, references, trigger
  on public.project_phases, public.project_activities
  from anon, authenticated;
