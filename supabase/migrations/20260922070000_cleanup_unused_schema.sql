-- Curățenie schemă: tabele/view-uri/funcții nefolosite din modelul vechi
-- "programe -> măsuri -> sesiuni", înlocuit de "project_templates -> template_phases -> template_activities".
-- Vezi issue #101 pentru auditul complet (grep în app/lib/components, FK-uri, view-uri, triggere).

-- 1. Views — nimic altceva din baza de date nu depinde de ele
DROP VIEW IF EXISTS "public"."funding_hierarchy";
DROP VIEW IF EXISTS "public"."measures_overview";
DROP VIEW IF EXISTS "public"."programs_overview";
DROP VIEW IF EXISTS "public"."project_activities_complete";
DROP VIEW IF EXISTS "public"."project_phases_with_status";
DROP VIEW IF EXISTS "public"."project_progress_view";
DROP VIEW IF EXISTS "public"."sessions_overview";
DROP VIEW IF EXISTS "public"."templates_overview";
DROP VIEW IF EXISTS "public"."activity_documents_status";
DROP VIEW IF EXISTS "public"."template_document_attachment_stale_references";

-- 2. Trigger + funcții moarte pe tabele care rămân (trebuie șterse înainte de funcții)
DROP TRIGGER IF EXISTS trigger_create_project_phases ON public.projects;
DROP FUNCTION IF EXISTS public.create_project_phases_from_measure();
DROP FUNCTION IF EXISTS public.add_session(uuid, text, text, date, date, numeric);
DROP FUNCTION IF EXISTS public.complete_document_upload_batch(uuid, uuid, integer, uuid, jsonb, text);

-- 3. Constraint de eliminat ÎNAINTE de tabele (altfel pică DROP TABLE measure_sessions)
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_session_id_fkey;

-- 4. Tabele — ordinea contează, respectă foreign keys
DROP TABLE IF EXISTS public.activity_document_files; -- are FK spre activity_document_requirements

-- update_requirement_status() are trigger-e (trigger_update_req_status_insert/update) definite
-- pe activity_document_files, deci funcția nu poate fi ștearsă înainte ca tabela (și triggerele
-- ei) să dispară — altfel DROP FUNCTION pică cu eroare de dependență.
DROP FUNCTION IF EXISTS public.update_requirement_status();

DROP TABLE IF EXISTS public.activity_document_requirements;
DROP TABLE IF EXISTS public.measure_activity_templates; -- are FK spre measure_phase_templates
DROP TABLE IF EXISTS public.measure_phase_templates;    -- are FK spre program_measures (rămâne neatinsă)
DROP TABLE IF EXISTS public.measure_sessions;            -- are FK spre program_measures (rămâne neatinsă)
