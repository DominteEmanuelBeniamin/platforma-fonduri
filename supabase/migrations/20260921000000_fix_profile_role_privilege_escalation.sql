-- Închide escaladarea de privilegii pe public.profiles.role.
--
-- Vector 1: handle_new_user() citea rolul din auth.users.raw_user_meta_data,
-- un câmp controlat integral de utilizator la signup. Fluxul real de creare
-- de conturi (app/api/users/route.ts) nu trimite deloc `role` în metadata —
-- setează rolul separat, după creare, prin service_role — deci ignorarea
-- metadatelor aici nu afectează nimic funcțional.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'client');
  return new;
end;
$$;

-- Vector 2: grantul "ALL" către anon/authenticated pe profiles, combinat cu
-- policy-ul de UPDATE care verifică doar `auth.uid() = id` (fără WITH CHECK),
-- permitea oricărui cont autentificat să-și schimbe singur `role` la 'admin'.
-- Toată aplicația citește/scrie profiles exclusiv prin service_role
-- (createSupabaseServiceClient) — niciun cod de client nu are nevoie ca
-- anon/authenticated să scrie direct în profiles.
revoke insert, update, delete on public.profiles from anon, authenticated;
