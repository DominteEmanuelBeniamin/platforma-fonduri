-- Eticheta „Modificări neaplicate în proiecte” (drepturi admin/senior/junior).
--
-- Un consultant senior poate modifica un șablon publicat, dar numai adminul
-- aplică modificările în proiectele existente. Coloana ține minte că există
-- modificări de conținut (faze, activități, documente) după ultima aplicare;
-- se golește când adminul rulează propagarea sau publică șablonul.
alter table public.project_templates
  add column if not exists unpropagated_changes_at timestamptz;
