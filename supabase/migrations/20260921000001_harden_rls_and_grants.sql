-- Întărește accesul direct (anon/authenticated) pe tabelele unde aplicația
-- scrie/citește exclusiv prin service_role. Verificat: zero `.from()` direct
-- din cod de browser pe tabelele de mai jos (grep în app/, components/, lib/,
-- exclus app/api/ care rulează server-side, cu service_role).

-- profiles: policy-ul de SELECT era `USING (true)` — orice cont autentificat
-- putea citi CIF/adresă/telefon din profilul ORICUI altcuiva. Restrângem la
-- propriul rând; funcțiile care verifică rolul (is_admin, get_my_role) sunt
-- SECURITY DEFINER și citesc mereu doar rândul apelantului, deci nu sunt
-- afectate de restrângere.
drop policy if exists "Allow all authenticated reads" on public.profiles;
create policy "Users can read own profile" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

-- document_requirements, files: policy-uri `USING`/`WITH CHECK (true)` —
-- acces total, pe orice rând, pentru orice cont autentificat. Celelalte
-- policy-uri mai restrictive de pe aceste tabele erau oricum anulate de
-- policy-urile astea (Postgres combină policy-urile permisive prin OR).
revoke insert, update, select on public.document_requirements from anon, authenticated;
revoke insert, update, select on public.files from anon, authenticated;

-- project_members: policy-ul de SELECT era `USING (true)` — orice cont
-- autentificat vedea toate atribuirile consultant↔proiect din toată
-- platforma. NU revocăm grantul aici: `is_consultant_member_of_project()`
-- (folosită de `can_access_project()`, care gărzuiește chat-ul de proiect)
-- nu e SECURITY DEFINER și are nevoie ca `authenticated` să-și poată citi
-- propriul rând din project_members — restrângem policy-ul, nu grantul.
--
-- Verificarea "e clientul acestui proiect" trece printr-o funcție SECURITY
-- DEFINER (la fel ca `is_admin()`) în loc de un subselect direct pe
-- `projects`: `projects` are propriul ei policy care citește înapoi din
-- `project_members` ("Consultant View Team Projects") — un subselect direct
-- aici ar crea recursivitate infinită între cele două policy-uri.
create or replace function public.is_project_client(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.projects
    where projects.id = p_project_id and projects.client_id = auth.uid()
  );
$$;

drop policy if exists "Allow authenticated to read project_members" on public.project_members;
create policy "Members can read relevant project_members rows" on public.project_members
  for select to authenticated
  using (
    consultant_id = auth.uid()
    or public.is_admin()
    or public.is_project_client(project_id)
  );

-- audit_logs: orice cont autentificat putea insera rânduri arbitrare
-- (falsificând acțiuni/user_id/descrieri). Aplicația scrie audit exclusiv
-- prin service_role.
revoke insert, select on public.audit_logs from anon, authenticated;

-- project_chat_events, project_chat_reads: aveau GRANT ALL, dar o singură
-- policy (SELECT) — restul comenzilor erau oricum blocate de RLS. Igienă,
-- nu fix de vulnerabilitate: restrângem grantul ca să reflecte ce e permis.
revoke insert, update, delete on public.project_chat_events from anon, authenticated;
revoke insert, update, delete on public.project_chat_reads from anon, authenticated;
