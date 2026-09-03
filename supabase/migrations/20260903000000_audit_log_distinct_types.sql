-- Valorile distincte de action_type/entity_type, agregate în DB.
--
-- `audit:check` are nevoie de ~15 valori distincte; fără asta le obținea
-- trăgând prin PostgREST fiecare rând din audit_logs, câte 1000. Pe un tabel
-- care prin definiție doar crește și nu se mai șterge niciodată (vezi
-- 20260902000000_audit_logs_append_only), verificarea ar fi devenit tot mai
-- lentă cu fiecare zi de folosire.
CREATE OR REPLACE FUNCTION public.audit_log_distinct_types()
RETURNS TABLE (action_type text, entity_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT l.action_type, l.entity_type FROM public.audit_logs AS l
$$;

-- Numai service_role: jurnalul de audit rămâne închis pentru sesiunile de
-- browser, la fel ca tabela din spate.
REVOKE ALL ON FUNCTION public.audit_log_distinct_types() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_log_distinct_types() TO service_role;
