-- audit_logs is an immutable append-only journal.
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION
      'Append-only audit_logs migration requires existing table public.audit_logs';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_audit_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'public.audit_logs is append-only; % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON public.audit_logs;

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_logs_mutation();

REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM anon, authenticated;
