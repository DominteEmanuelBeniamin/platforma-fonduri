-- Nivelul consultantului (issue #104): junior / senior.
--
-- Rolul rămâne `consultant`; nivelul e un câmp separat ca să nu rupă
-- verificările `role = 'consultant'`. Toți consultanții existenți pornesc
-- `junior`, iar adminul îi promovează explicit. Pentru alte roluri valoarea
-- e ignorată.
--
-- Protecția la scriere vine din 20260921000000: anon/authenticated nu au
-- INSERT/UPDATE/DELETE pe public.profiles, deci nivelul se scrie doar prin
-- service_role (PATCH /api/users/[userId], admin-only).
alter table public.profiles
  add column if not exists consultant_level text not null default 'junior';

alter table public.profiles
  drop constraint if exists profiles_consultant_level_check;

alter table public.profiles
  add constraint profiles_consultant_level_check
  check (consultant_level in ('junior', 'senior'));

-- Plasă de siguranță: chiar dacă un grant de UPDATE ar fi redat vreodată,
-- nivelul tot nu se poate scrie din clientul din browser.
revoke insert, update, delete on public.profiles from anon, authenticated;
