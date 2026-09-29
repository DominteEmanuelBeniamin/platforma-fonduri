-- Baseline: obiectele custom din schemele gestionate de platformă (auth/storage),
-- extrase din producție. Restul schemelor auth/storage vin din stack-ul Supabase
-- însuși la `supabase start` — aici punem doar ce am adăugat noi peste ele.

create trigger "on_auth_user_created"
  after insert on "auth"."users"
  for each row execute function "public"."handle_new_user"();

create policy "Storage Access Policy" on "storage"."objects"
  for select to "authenticated"
  using (
    (bucket_id = 'project-files'::text)
    and (
      ((select profiles.role from public.profiles where profiles.id = auth.uid()) = 'admin'::text)
      or ((split_part(name, '/'::text, 1))::uuid in (
        select projects.id from public.projects where projects.client_id = auth.uid()
      ))
      or ((split_part(name, '/'::text, 1))::uuid in (
        select project_members.project_id from public.project_members where project_members.consultant_id = auth.uid()
      ))
    )
  );

create policy "Storage Upload Policy" on "storage"."objects"
  for insert to "authenticated"
  with check (
    (bucket_id = 'project-files'::text)
    and (
      ((select profiles.role from public.profiles where profiles.id = auth.uid()) = 'admin'::text)
      or ((split_part(name, '/'::text, 1))::uuid in (
        select projects.id from public.projects where projects.client_id = auth.uid()
        union
        select project_members.project_id from public.project_members where project_members.consultant_id = auth.uid()
      ))
    )
  );
