-- Ce are nevoie `npm run audit:check` ca să verifice, nu să presupună.
--
-- PostgREST nu expune `information_schema` și `pg_catalog` pe proiectele
-- Supabase, deci verificările structurale scrise peste ele nu puteau reuși
-- niciodată: scriptul ieșea mereu cu 1 și nu confirma nimic. Faptele se citesc
-- acum din catalog printr-o funcție `SECURITY DEFINER`, accesibilă doar de
-- `service_role`.

-- Valorile distincte de action_type/entity_type, agregate în DB. Fără asta,
-- scriptul trăgea prin PostgREST fiecare rând din `audit_logs`, câte 1000, doar
-- ca să afle ~15 valori — pe un tabel care, fiind append-only (vezi
-- 20260902000000), doar crește și nu se mai șterge niciodată.
CREATE OR REPLACE FUNCTION public.audit_log_distinct_types()
RETURNS TABLE (action_type text, entity_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT l.action_type, l.entity_type FROM public.audit_logs AS l
$$;

-- Structura pe care se sprijină pagina de audit și jurnalul append-only:
-- coloanele, indexurile și triggerul, cu tot cu momentul și evenimentele lui.
CREATE OR REPLACE FUNCTION public.audit_logs_contract()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'table_exists', to_regclass('public.audit_logs') IS NOT NULL,
    'columns', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'nullable', NOT a.attnotnull
      ) ORDER BY a.attnum), '[]'::jsonb)
      FROM pg_attribute AS a
      WHERE a.attrelid = to_regclass('public.audit_logs')
        AND a.attnum > 0
        AND NOT a.attisdropped
    ),
    'indexes', (
      SELECT coalesce(jsonb_agg(i.indexname ORDER BY i.indexname), '[]'::jsonb)
      FROM pg_indexes AS i
      WHERE i.schemaname = 'public' AND i.tablename = 'audit_logs'
    ),
    -- NULL dacă triggerul lipsește; altfel biții din `tgtype`, ca apelantul să
    -- vadă chiar contractul, nu doar prezența numelui.
    'append_only_trigger', (
      SELECT jsonb_build_object(
        'row_level', (t.tgtype & 1) <> 0,
        'before', (t.tgtype & 2) <> 0,
        'on_delete', (t.tgtype & 8) <> 0,
        'on_update', (t.tgtype & 16) <> 0,
        'enabled', t.tgenabled <> 'D'
      )
      FROM pg_trigger AS t
      WHERE t.tgrelid = to_regclass('public.audit_logs')
        AND t.tgname = 'audit_logs_append_only'
        AND NOT t.tgisinternal
    )
  )
$$;

-- Numărătorile pentru pagina de audit, agregate în DB.
--
-- Citite rând cu rând prin PostgREST, se opreau tăcut la lotul implicit de 1000:
-- pe un jurnal de câteva mii de intrări, cardurile „Autentificări" și
-- „Modificări" ajungeau să arate 0 fiindcă `login` și `update` nici nu apucau
-- să intre în lot.
CREATE OR REPLACE FUNCTION public.audit_log_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.audit_logs),
    'recent', (SELECT count(*) FROM public.audit_logs WHERE created_at >= now() - interval '7 days'),
    'by_action', (
      SELECT coalesce(jsonb_object_agg(t.action_type, t.n), '{}'::jsonb)
      FROM (SELECT action_type, count(*) AS n FROM public.audit_logs GROUP BY action_type) AS t
    ),
    'by_entity', (
      SELECT coalesce(jsonb_object_agg(t.entity_type, t.n), '{}'::jsonb)
      FROM (SELECT entity_type, count(*) AS n FROM public.audit_logs GROUP BY entity_type) AS t
    )
  )
$$;

-- Numai service_role: jurnalul de audit și structura lui rămân închise pentru
-- sesiunile de browser, la fel ca tabela din spate.
REVOKE ALL ON FUNCTION public.audit_log_distinct_types() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_logs_contract() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_log_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_log_distinct_types() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_logs_contract() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_log_counts() TO service_role;
