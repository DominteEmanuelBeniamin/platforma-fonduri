-- Issue #79: backfill unic pentru elementele deja vizibile clientului.
-- Nu trimite email; neutralizează digestul istoric pentru conținutul publicat.

update public.project_phases
set client_notified_at = now()
where visibility = 'published'
  and client_notified_at is null;

update public.project_activities as a
set client_notified_at = now()
from public.project_phases as p
where a.phase_id = p.id
  and a.visibility = 'published'
  and p.visibility = 'published'
  and a.client_notified_at is null;

update public.document_requirements as d
set client_notified_at = now()
where d.visibility = 'published'
  and d.deleted_at is null
  and d.client_notified_at is null
  and (
    d.activity_id is null
    or exists (
      select 1
      from public.project_activities as a
      join public.project_phases as p on p.id = a.phase_id
      where a.id = d.activity_id
        and a.visibility = 'published'
        and p.visibility = 'published'
        and p.project_id = d.project_id
    )
  );
