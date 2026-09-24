DROP VIEW IF EXISTS public.funding_hierarchy;
DROP VIEW IF EXISTS public.measures_overview;
DROP VIEW IF EXISTS public.programs_overview;
DROP VIEW IF EXISTS public.project_activities_complete;
DROP VIEW IF EXISTS public.project_phases_with_status;
DROP VIEW IF EXISTS public.project_progress_view;
DROP VIEW IF EXISTS public.sessions_overview;
DROP VIEW IF EXISTS public.templates_overview;
DROP VIEW IF EXISTS public.activity_documents_status;
DROP VIEW IF EXISTS public.template_document_attachment_stale_references;

DROP TRIGGER IF EXISTS trigger_create_project_phases ON public.projects;
DROP TRIGGER IF EXISTS trigger_update_req_status_insert ON public.activity_document_files;
DROP TRIGGER IF EXISTS trigger_update_req_status_update ON public.activity_document_files;
DROP FUNCTION IF EXISTS public.create_project_phases_from_measure();
DROP FUNCTION IF EXISTS public.add_session(uuid, text, text, date, date, numeric);
DROP FUNCTION IF EXISTS public.complete_document_upload_batch(uuid, uuid, integer, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.import_template_to_project(uuid, uuid);
DROP FUNCTION IF EXISTS public.update_requirement_status();

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_session_id_fkey;

DROP TABLE IF EXISTS public.activity_document_files;
DROP TABLE IF EXISTS public.activity_document_requirements;
DROP TABLE IF EXISTS public.measure_activity_templates;
DROP TABLE IF EXISTS public.measure_phase_templates;
DROP TABLE IF EXISTS public.measure_sessions;
