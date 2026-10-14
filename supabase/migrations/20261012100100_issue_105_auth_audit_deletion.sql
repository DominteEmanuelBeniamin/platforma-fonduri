-- Authentication alone does not turn a mistaken account into business history.
-- Keep audit rows append-only, including their historical author UUID/email.
-- The issue #105 insert guard validates and locks every new non-null author.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname = 'issue105_audit_author_guard'
      AND tgfoid = 'public.issue105_guard_audit_author()'::regprocedure
      AND tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'The issue #105 audit author guard must be enabled';
  END IF;
END;
$guard$;

-- SET NULL would mutate immutable audit records when the profile is removed.
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
COMMENT ON COLUMN public.audit_logs.user_id IS
  'Historical author UUID, retained after eligible account deletion; new authors are validated by issue105_audit_author_guard.';

CREATE OR REPLACE FUNCTION public.user_account_blockers(p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_fk record;
  v_join_condition text;
  v_fields text;
  v_kind text;
  v_count bigint;
  v_seen text[] := ARRAY[]::text[];
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF p_target_id IS NULL THEN
    RETURN v_blockers;
  END IF;

  FOR v_fk IN
    SELECT
      c.conrelid,
      c.confrelid,
      child_ns.nspname AS child_schema,
      child.relname AS child_table,
      parent_ns.nspname AS parent_schema,
      parent.relname AS parent_table,
      c.conkey,
      c.confkey,
      c.conname
    FROM pg_constraint AS c
    JOIN pg_class AS child ON child.oid = c.conrelid
    JOIN pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class AS parent ON parent.oid = c.confrelid
    JOIN pg_namespace AS parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE c.contype = 'f'
      AND child_ns.nspname = 'public'
      AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
      AND c.conrelid <> 'public.audit_logs'::regclass
      AND NOT (
        c.conrelid = 'public.profiles'::regclass
        AND c.confrelid = 'auth.users'::regclass
        AND cardinality(c.conkey) = 1
        AND cardinality(c.confkey) = 1
        AND EXISTS (
          SELECT 1
          FROM pg_attribute AS child_id
          JOIN pg_attribute AS auth_id
            ON auth_id.attrelid = c.confrelid
           AND auth_id.attnum = c.confkey[1]
          WHERE child_id.attrelid = c.conrelid
            AND child_id.attnum = c.conkey[1]
            AND child_id.attname = 'id'
            AND auth_id.attname = 'id'
        )
      )
    ORDER BY child_ns.nspname, child.relname, c.conname
  LOOP
    SELECT
      string_agg(format('r.%I = p.%I', child_attr.attname, parent_attr.attname), ' AND ' ORDER BY keys.ord),
      string_agg(child_attr.attname, ',' ORDER BY keys.ord)
    INTO v_join_condition, v_fields
    FROM unnest(v_fk.conkey, v_fk.confkey) WITH ORDINALITY AS keys(child_attnum, parent_attnum, ord)
    JOIN pg_attribute AS child_attr
      ON child_attr.attrelid = v_fk.conrelid AND child_attr.attnum = keys.child_attnum
    JOIN pg_attribute AS parent_attr
      ON parent_attr.attrelid = v_fk.confrelid AND parent_attr.attnum = keys.parent_attnum;

    v_kind := format('%s.%s.%s', v_fk.child_schema, v_fk.child_table, v_fields);
    IF v_kind = ANY(v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_kind);

    EXECUTE format(
      'SELECT count(*) FROM %I.%I AS r WHERE EXISTS (' ||
      'SELECT 1 FROM %I.%I AS p WHERE p.id = $1 AND %s)',
      v_fk.child_schema,
      v_fk.child_table,
      v_fk.parent_schema,
      v_fk.parent_table,
      v_join_condition
    )
    INTO v_count
    USING p_target_id;

    IF v_count > 0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('kind', v_kind, 'count', v_count));
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM public.audit_logs
  WHERE user_id = p_target_id
    AND (
      action_type IN ('login', 'logout')
      AND entity_type = 'user'
      AND entity_id = p_target_id
      AND nullif(btrim(entity_name), '') IS NOT NULL
    ) IS NOT TRUE;
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('kind', 'public.audit_logs.user_id', 'count', v_count)
    );
  END IF;

  SELECT count(*) INTO v_count
  FROM storage.objects AS o
  WHERE o.owner = p_target_id
     OR CASE
       WHEN pg_input_is_valid(o.owner_id, 'uuid') THEN o.owner_id::uuid = p_target_id
       ELSE false
     END;
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(
      jsonb_build_object('kind', 'storage.objects.owner/owner_id', 'count', v_count)
    );
  END IF;

  RETURN v_blockers;
END
$function$;

REVOKE ALL ON FUNCTION public.user_account_blockers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_account_blockers(uuid) TO service_role;
