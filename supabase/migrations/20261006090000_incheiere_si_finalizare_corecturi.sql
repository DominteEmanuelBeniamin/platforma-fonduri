-- Corecturi după verificarea #109 (6 octombrie 2026).
--
-- 1. Starea proiectului are doar două valori: în lucru și încheiat. Celelalte
--    trei permise de CHECK-ul vechi (suspended, cancelled, archived) nu sunt
--    scrise de nicio parte a aplicației, dar un rând cu ele apărea „Încheiat”,
--    cu „Redeschide proiectul” în meniu, iar /reopen răspundea 409 „Proiectul nu
--    e încheiat” — un proiect blocat fără cale de ieșire. Verificat în producție
--    pe 6 octombrie 2026: toate proiectele sunt `active`.
--
-- 2. Clientul nu citește prin PostgREST cine a încheiat sau a finalizat ceva.
--    API-ul ascundea deja `closed_by` și `completed_by`, dar grant-urile de bază
--    lăsau orice utilizator autentificat să le citească direct, cu cheia publică.
--    Fazele și activitățile nu sunt citite din browser și nicio funcție RLS nu le
--    citește ca invoker (verificat: doar politicile lor proprii și funcții
--    SECURITY DEFINER), deci SELECT-ul se revocă întreg. `projects` e citit ca
--    invoker de `can_access_project` și de politicile de storage, deci primește
--    grant pe coloane: toate, în afară de `closed_by`.

-- ─── 1. Starea proiectului ───────────────────────────────────────────────────

-- Plasă de siguranță pentru alte baze (în producție nu e niciun rând): cronul
-- tratează deja orice stare în afară de `active` ca proiect oprit, deci
-- `completed` păstrează comportamentul și face proiectul redeschidibil.
update public.projects
set lifecycle_status = 'completed', closed_at = coalesce(closed_at, updated_at, now())
where lifecycle_status not in ('active', 'completed');

alter table public.projects drop constraint if exists projects_lifecycle_status_check;
alter table public.projects
  add constraint projects_lifecycle_status_check
  check (lifecycle_status in ('active', 'completed'));

-- ─── 2. Citirile directe ─────────────────────────────────────────────────────

revoke select on public.project_phases, public.project_activities from anon, authenticated;

revoke select on public.projects from anon, authenticated;
grant select (
  id, title, client_id, status, progress, created_at, program_id, measure_id, session_id,
  cod_proiect, cod_intern, telefon_contact, email_contact, persoana_contact, is_preluat,
  preluat_detalii, current_phase_slug, lifecycle_status, updated_at, current_status_id,
  template_id, general_consultant_id, automatic_reminders_enabled, closed_at
) on public.projects to authenticated;
