-- advance_project_status is not called by the application. Keep it available
-- for server-side maintenance, but remove its SECURITY DEFINER escalation path
-- and prevent direct Data API calls from public client roles.
alter function public.advance_project_status(uuid) security invoker;
alter function public.advance_project_status(uuid)
  set search_path = pg_catalog, public;

revoke all on function public.advance_project_status(uuid) from public, anon, authenticated;
grant execute on function public.advance_project_status(uuid) to service_role;

-- RLS policies use get_my_role for the current authenticated user. Its body
-- already qualifies both public.profiles and auth.uid(), so an empty search
-- path is safe and prevents object-shadowing in this SECURITY DEFINER function.
alter function public.get_my_role() set search_path = '';

revoke all on function public.get_my_role() from public, anon;
grant execute on function public.get_my_role() to authenticated, service_role;

-- Table privileges were revoked in 20260921000001_harden_rls_and_grants.sql.
-- Remove the obsolete permissive write policies as defense in depth.
drop policy if exists "Allow authenticated to insert document_requirements"
  on public.document_requirements;
drop policy if exists "Allow authenticated to update document_requirements"
  on public.document_requirements;
drop policy if exists "Allow authenticated to insert files"
  on public.files;
drop policy if exists "Allow authenticated to update files"
  on public.files;
