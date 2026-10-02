-- Preview-ul de propagare și blocajul la ștergerea unui șablon caută
-- proiectele după template_id; fără index, fiecare căutare scanează projects.
create index if not exists idx_projects_template_id
  on public.projects (template_id)
  where template_id is not null;
