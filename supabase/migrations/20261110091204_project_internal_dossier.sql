-- Dosar intern separat de fișierele expuse fluxului clientului.
CREATE TABLE public.project_internal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '',
  phase_id uuid REFERENCES public.project_phases(id) ON DELETE SET NULL,
  activity_id uuid REFERENCES public.project_activities(id) ON DELETE SET NULL,
  document_requirement_id uuid REFERENCES public.document_requirements(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT project_internal_entries_one_context
    CHECK (num_nonnulls(phase_id, activity_id, document_requirement_id) <= 1)
);

CREATE INDEX project_internal_entries_project_created_idx
  ON public.project_internal_entries (project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER update_project_internal_entries_updated_at
  BEFORE UPDATE ON public.project_internal_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.project_internal_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.project_internal_entries(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL CHECK (length(btrim(original_name)) BETWEEN 1 AND 255),
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size BETWEEN 0 AND 26214400),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX project_internal_attachments_entry_created_idx
  ON public.project_internal_attachments (entry_id, created_at)
  WHERE deleted_at IS NULL AND uploaded_at IS NOT NULL;

ALTER TABLE public.project_internal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_internal_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_internal_entries, public.project_internal_attachments
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_internal_entries, public.project_internal_attachments TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project-internal', 'project-internal', false, 26214400)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit;
