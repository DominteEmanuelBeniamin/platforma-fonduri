-- Ordine manuală pentru cererile de documente (issue #21).
-- order_index devine sursa de adevăr pentru afișare; backfill pe ordinea creării.

alter table public.document_requirements
  add column if not exists order_index integer not null default 0;

-- Backfill per (project_id, activity_id), cel mai vechi primul.
-- activity_id NULL („Cereri generale") formează propria partiție.
-- Guard-ul order_index = 0 face re-rularea sigură (nu suprascrie reordonări manuale).
with ranked as (
  select id,
         row_number() over (
           partition by project_id, activity_id
           order by created_at asc
         ) as rn
  from public.document_requirements
)
update public.document_requirements dr
set order_index = ranked.rn
from ranked
where dr.id = ranked.id
  and dr.order_index = 0;

create index if not exists document_requirements_project_order_idx
  on public.document_requirements(project_id, activity_id, order_index)
  where deleted_at is null;
