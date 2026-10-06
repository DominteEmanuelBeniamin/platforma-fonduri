-- Issue #105: account lifecycle and guarded hard-delete primitives.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid,
  ADD COLUMN IF NOT EXISTS auth_ban_before_lifecycle timestamptz,
  ADD COLUMN IF NOT EXISTS auth_ban_applied_by_lifecycle timestamptz,
  ADD COLUMN IF NOT EXISTS auth_sync_pending boolean NOT NULL DEFAULT false;

UPDATE public.profiles SET is_active = true WHERE is_active IS NULL;
ALTER TABLE public.profiles
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL;

UPDATE public.profiles
SET auth_sync_pending = true
WHERE is_active IS FALSE;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_deactivated_by_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_deactivated_by_fkey
      FOREIGN KEY (deactivated_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS profiles_deactivated_by_idx
  ON public.profiles (deactivated_by)
  WHERE deactivated_by IS NOT NULL;

DO $compat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'sessions'
      AND column_name = 'not_after' AND data_type = 'timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'sessions'
      AND column_name = 'id' AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'sessions'
      AND column_name = 'user_id' AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'banned_until' AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Incompatible Auth schema: expected sessions.id/user_id UUID, not_after timestamptz, and users.banned_until timestamptz';
  END IF;
  IF NOT has_table_privilege('postgres', 'auth.users', 'SELECT')
     OR NOT has_table_privilege('postgres', 'auth.users', 'UPDATE')
     OR NOT has_table_privilege('postgres', 'auth.users', 'DELETE')
     OR NOT has_table_privilege('postgres', 'auth.sessions', 'SELECT')
     OR NOT has_table_privilege('postgres', 'auth.sessions', 'DELETE')
     OR NOT has_table_privilege('postgres', 'storage.objects', 'SELECT')
     OR NOT has_table_privilege('postgres', 'public.audit_logs', 'SELECT')
     OR NOT has_table_privilege('postgres', 'public.audit_logs', 'INSERT') THEN
    RAISE EXCEPTION 'Incompatible privileges: postgres requires Auth session/user, Storage owner, and audit access used by Issue #105';
  END IF;
END
$compat$;

CREATE OR REPLACE FUNCTION public.current_account_session_active()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid;
  v_session_id uuid;
BEGIN
  BEGIN
    v_user_id := auth.uid();
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN false;
  END;

  IF v_user_id IS NULL OR v_session_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    JOIN auth.sessions AS s ON s.user_id = p.id
    WHERE p.id = v_user_id
      AND p.is_active IS TRUE
      AND (u.banned_until IS NULL OR u.banned_until <= statement_timestamp())
      AND s.id = v_session_id
      AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
  );
END
$function$;

REVOKE ALL ON FUNCTION public.current_account_session_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_account_session_active() TO authenticated, service_role;

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
  WHERE user_id = p_target_id;
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

CREATE OR REPLACE FUNCTION public.set_user_account_active(
  p_target_id uuid,
  p_actor_id uuid,
  p_active boolean,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_locked_id uuid;
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_current_ban timestamptz;
  v_previous_ban timestamptz;
  v_applied_ban timestamptz;
  v_next_ban timestamptz;
  v_sync boolean := false;
  v_changed boolean := false;
  v_profile_json jsonb;
BEGIN
  IF p_target_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;
  IF p_target_id = p_actor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SELF_ACCOUNT_ACTION';
  END IF;
  IF p_active IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;

  -- ponytail: global lock on account-sensitive writes; use ordered per-profile locks only if measured throughput needs it.
  PERFORM pg_advisory_xact_lock(105, 1);

  FOR v_locked_id IN
    SELECT p.id
    FROM public.profiles AS p
    WHERE p.id IN (p_actor_id, p_target_id)
    ORDER BY p.id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role <> 'admin' OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;

  IF p_active IS FALSE
     AND v_target.role = 'admin'
     AND v_target.is_active IS TRUE
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active IS TRUE) <= 1
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ACTIVE_ADMIN';
  END IF;

  IF p_active IS TRUE AND v_target.is_active IS TRUE THEN
    SELECT jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'full_name', p.full_name,
      'role', p.role,
      'consultant_level', p.consultant_level,
      'telefon', p.telefon,
      'cif', p.cif,
      'nume_firma', p.nume_firma,
      'adresa_firma', p.adresa_firma,
      'departament', p.departament,
      'specializare', p.specializare,
      'is_active', p.is_active,
      'auth_sync_pending', p.auth_sync_pending
    ) INTO v_profile_json
    FROM public.profiles AS p WHERE p.id = p_target_id;
    RETURN jsonb_build_object('profile', v_profile_json, 'changed', false, 'authSynced', true);
  END IF;

  IF p_active IS FALSE THEN
    IF v_target.is_active IS TRUE THEN
      UPDATE public.profiles
      SET is_active = false,
          deactivated_at = clock_timestamp(),
          deactivated_by = p_actor_id,
          auth_ban_before_lifecycle = NULL,
          auth_ban_applied_by_lifecycle = NULL,
          auth_sync_pending = true,
          updated_at = clock_timestamp()
      WHERE id = p_target_id;

      v_changed := true;
    ELSIF v_target.auth_sync_pending IS NOT TRUE THEN
      SELECT jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'full_name', p.full_name,
        'role', p.role,
        'consultant_level', p.consultant_level,
        'telefon', p.telefon,
        'cif', p.cif,
        'nume_firma', p.nume_firma,
        'adresa_firma', p.adresa_firma,
        'departament', p.departament,
        'specializare', p.specializare,
        'is_active', p.is_active,
        'auth_sync_pending', p.auth_sync_pending
      ) INTO v_profile_json
      FROM public.profiles AS p WHERE p.id = p_target_id;
      RETURN jsonb_build_object('profile', v_profile_json, 'changed', false, 'authSynced', true);
    END IF;

    BEGIN
      SELECT u.banned_until INTO v_current_ban
      FROM auth.users AS u
      WHERE u.id = p_target_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
      END IF;

      SELECT p.auth_ban_before_lifecycle, p.auth_ban_applied_by_lifecycle
      INTO v_previous_ban, v_applied_ban
      FROM public.profiles AS p
      WHERE p.id = p_target_id;

      IF v_applied_ban IS NULL OR v_current_ban IS DISTINCT FROM v_applied_ban THEN
        v_previous_ban := v_current_ban;
      END IF;

      v_next_ban := clock_timestamp() + interval '10 years';
      IF v_previous_ban IS NOT NULL AND v_previous_ban > v_next_ban THEN
        v_next_ban := v_previous_ban;
      END IF;

      UPDATE auth.users
      SET banned_until = v_next_ban
      WHERE id = p_target_id;
      DELETE FROM auth.sessions WHERE user_id = p_target_id;

      UPDATE public.profiles
      SET auth_ban_before_lifecycle = v_previous_ban,
          auth_ban_applied_by_lifecycle = v_next_ban,
          auth_sync_pending = false
      WHERE id = p_target_id;
      v_sync := true;
    EXCEPTION
      WHEN query_canceled THEN
        v_sync := false;
      WHEN OTHERS THEN
        v_sync := false;
    END;

    IF NOT v_sync THEN
      UPDATE public.profiles SET auth_sync_pending = true WHERE id = p_target_id;
    END IF;

    IF v_changed THEN
      INSERT INTO public.audit_logs (
        user_id, action_type, entity_type, entity_id, entity_name,
        old_values, new_values, description, ip_address, user_agent
      )
      VALUES (
        p_actor_id, 'update', 'user', p_target_id,
        coalesce(v_target.full_name, v_target.email),
        jsonb_build_object('is_active', true, 'auth_sync_pending', v_target.auth_sync_pending),
        jsonb_build_object('operation', 'deactivate', 'is_active', false, 'auth_sync_pending', NOT v_sync),
        format('Administratorul %s a dezactivat contul %s.', coalesce(v_actor.email, v_actor.full_name, p_actor_id::text), coalesce(v_target.email, v_target.full_name, p_target_id::text)),
        p_ip_address, p_user_agent
      );
    END IF;
  ELSE
    IF v_target.is_active IS NOT FALSE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
    END IF;

    BEGIN
      SELECT u.banned_until INTO v_current_ban
      FROM auth.users AS u
      WHERE u.id = p_target_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
      END IF;

      SELECT p.auth_ban_before_lifecycle, p.auth_ban_applied_by_lifecycle
      INTO v_previous_ban, v_applied_ban
      FROM public.profiles AS p
      WHERE p.id = p_target_id;

      DELETE FROM auth.sessions WHERE user_id = p_target_id;
      IF v_applied_ban IS NOT NULL AND v_current_ban IS NOT DISTINCT FROM v_applied_ban THEN
        UPDATE auth.users
        SET banned_until = v_previous_ban
        WHERE id = p_target_id;
      END IF;

      v_sync := true;
    EXCEPTION
      WHEN query_canceled THEN
        v_sync := false;
      WHEN OTHERS THEN
        v_sync := false;
    END;

    IF v_sync THEN
      UPDATE public.profiles
      SET is_active = true,
          deactivated_at = NULL,
          deactivated_by = NULL,
          auth_ban_before_lifecycle = NULL,
          auth_ban_applied_by_lifecycle = NULL,
          auth_sync_pending = false,
          updated_at = clock_timestamp()
      WHERE id = p_target_id;
      v_changed := true;

      INSERT INTO public.audit_logs (
        user_id, action_type, entity_type, entity_id, entity_name,
        old_values, new_values, description, ip_address, user_agent
      )
      VALUES (
        p_actor_id, 'update', 'user', p_target_id,
        coalesce(v_target.full_name, v_target.email),
        jsonb_build_object('is_active', false, 'auth_sync_pending', v_target.auth_sync_pending),
        jsonb_build_object('operation', 'reactivate', 'is_active', true, 'auth_sync_pending', false),
        format('Administratorul %s a reactivat contul %s.', coalesce(v_actor.email, v_actor.full_name, p_actor_id::text), coalesce(v_target.email, v_target.full_name, p_target_id::text)),
        p_ip_address, p_user_agent
      );
    ELSE
      UPDATE public.profiles
      SET is_active = false, auth_sync_pending = true
      WHERE id = p_target_id;
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'role', p.role,
    'consultant_level', p.consultant_level,
    'telefon', p.telefon,
    'cif', p.cif,
    'nume_firma', p.nume_firma,
    'adresa_firma', p.adresa_firma,
    'departament', p.departament,
    'specializare', p.specializare,
    'is_active', p.is_active,
    'auth_sync_pending', p.auth_sync_pending
  ) INTO v_profile_json
  FROM public.profiles AS p
  WHERE p.id = p_target_id;

  RETURN jsonb_build_object(
    'profile', v_profile_json,
    'changed', v_changed,
    'authSynced', v_sync
  );
END
$function$;

REVOKE ALL ON FUNCTION public.set_user_account_active(uuid, uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_account_active(uuid, uuid, boolean, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_empty_user_account(
  p_target_id uuid,
  p_actor_id uuid,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_locked_id uuid;
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_blockers jsonb;
BEGIN
  IF p_target_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;
  IF p_target_id = p_actor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SELF_ACCOUNT_ACTION';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);

  FOR v_locked_id IN
    SELECT p.id
    FROM public.profiles AS p
    WHERE p.id IN (p_actor_id, p_target_id)
    ORDER BY p.id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role <> 'admin' OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;

  IF v_target.role = 'admin'
     AND v_target.is_active IS TRUE
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active IS TRUE) <= 1
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ACTIVE_ADMIN';
  END IF;

  PERFORM 1 FROM auth.users WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;

  v_blockers := public.user_account_blockers(p_target_id);
  IF jsonb_array_length(v_blockers) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'USER_HAS_RELATED_DATA',
      DETAIL = jsonb_build_object('blockers', v_blockers)::text;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action_type, entity_type, entity_id, entity_name,
    old_values, description, ip_address, user_agent
  )
  VALUES (
    p_actor_id, 'delete', 'user', p_target_id,
    coalesce(v_target.full_name, v_target.email),
    jsonb_build_object(
      'id', v_target.id,
      'email', v_target.email,
      'full_name', v_target.full_name,
      'role', v_target.role,
      'is_active', v_target.is_active
    ),
    format('Administratorul %s a șters contul %s.', coalesce(v_actor.email, v_actor.full_name, p_actor_id::text), coalesce(v_target.email, v_target.full_name, p_target_id::text)),
    p_ip_address, p_user_agent
  );

  DELETE FROM auth.users WHERE id = p_target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'userId', p_target_id);
END
$function$;

REVOKE ALL ON FUNCTION public.delete_empty_user_account(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_empty_user_account(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.update_user_profile_guarded(
  p_target_id uuid,
  p_actor_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_locked_id uuid;
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_full_name text;
  v_role text;
  v_telefon text;
  v_cif text;
  v_consultant_level text;
  v_changed boolean;
  v_profile_json jsonb;
BEGIN
  IF p_target_id IS NULL OR p_actor_id IS NULL OR p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  IF p_changes - ARRAY['full_name', 'role', 'telefon', 'cif', 'consultant_level']::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);

  FOR v_locked_id IN
    SELECT p.id
    FROM public.profiles AS p
    WHERE p.id IN (p_actor_id, p_target_id)
    ORDER BY p.id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;
  IF p_actor_id <> p_target_id AND v_actor.role <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;
  IF (p_changes ? 'role' OR p_changes ? 'consultant_level') AND v_actor.role <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;

  v_full_name := CASE WHEN p_changes ? 'full_name' THEN p_changes ->> 'full_name' ELSE v_target.full_name END;
  v_role := CASE WHEN p_changes ? 'role' THEN p_changes ->> 'role' ELSE v_target.role END;
  v_telefon := CASE WHEN p_changes ? 'telefon' THEN p_changes ->> 'telefon' ELSE v_target.telefon END;
  v_cif := CASE WHEN p_changes ? 'cif' THEN p_changes ->> 'cif' ELSE v_target.cif END;
  v_consultant_level := CASE WHEN p_changes ? 'consultant_level' THEN p_changes ->> 'consultant_level' ELSE v_target.consultant_level END;

  IF p_changes ? 'full_name'
     AND (jsonb_typeof(p_changes -> 'full_name') <> 'string' OR nullif(btrim(v_full_name), '') IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  IF p_changes ? 'role'
     AND (jsonb_typeof(p_changes -> 'role') <> 'string' OR v_role NOT IN ('admin', 'client', 'consultant')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  IF p_changes ? 'consultant_level'
     AND (jsonb_typeof(p_changes -> 'consultant_level') <> 'string' OR v_consultant_level NOT IN ('junior', 'senior')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  IF (p_changes ? 'telefon' AND jsonb_typeof(p_changes -> 'telefon') NOT IN ('string', 'null'))
     OR (p_changes ? 'cif' AND jsonb_typeof(p_changes -> 'cif') NOT IN ('string', 'null')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;
  IF v_role <> 'consultant' AND v_consultant_level = 'senior' THEN
    v_consultant_level := 'junior';
  END IF;
  IF v_role <> 'consultant' AND p_changes ? 'consultant_level' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PROFILE_PATCH';
  END IF;

  IF v_target.is_active IS TRUE
     AND v_target.role = 'admin'
     AND v_role <> 'admin'
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active IS TRUE) <= 1
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ACTIVE_ADMIN';
  END IF;

  v_changed := v_full_name IS DISTINCT FROM v_target.full_name
    OR v_role IS DISTINCT FROM v_target.role
    OR v_telefon IS DISTINCT FROM v_target.telefon
    OR v_cif IS DISTINCT FROM v_target.cif
    OR v_consultant_level IS DISTINCT FROM v_target.consultant_level;

  IF v_changed THEN
    UPDATE public.profiles
    SET full_name = v_full_name,
        role = v_role,
        telefon = v_telefon,
        cif = v_cif,
        consultant_level = v_consultant_level,
        updated_at = clock_timestamp()
    WHERE id = p_target_id;
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'role', p.role,
    'consultant_level', p.consultant_level,
    'telefon', p.telefon,
    'cif', p.cif,
    'nume_firma', p.nume_firma,
    'adresa_firma', p.adresa_firma,
    'departament', p.departament,
    'specializare', p.specializare,
    'is_active', p.is_active,
    'auth_sync_pending', p.auth_sync_pending
  ) INTO v_profile_json
  FROM public.profiles AS p
  WHERE p.id = p_target_id;

  RETURN jsonb_build_object('profile', v_profile_json, 'changed', v_changed);
END
$function$;

REVOKE ALL ON FUNCTION public.update_user_profile_guarded(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_profile_guarded(uuid, uuid, jsonb) TO service_role;
-- Import finalization keeps the last assignment checks and project state change
-- in one transaction after all imported rows have been inserted.
CREATE OR REPLACE FUNCTION public.finalize_template_import(
  p_project_id uuid,
  p_template_id uuid,
  p_first_status_id uuid,
  p_actor_id uuid,
  p_assignments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_item jsonb;
  v_assignment jsonb;
  v_activity_id uuid;
  v_template_activity_id uuid;
  v_consultant_id uuid;
  v_explicit boolean;
  v_activity_ids uuid[] := ARRAY[]::uuid[];
  v_assignments jsonb := '[]'::jsonb;
  v_assigned jsonb := '[]'::jsonb;
  v_added_members jsonb := '[]'::jsonb;
  v_omitted jsonb := '[]'::jsonb;
  v_invalid jsonb := '[]'::jsonb;
  v_reason text;
  v_actor public.profiles%ROWTYPE;
  v_assignee public.profiles%ROWTYPE;
  v_member_id uuid;
  v_project_template_id uuid;
  v_member record;
  v_updated_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);

  IF p_project_id IS NULL OR p_template_id IS NULL OR p_actor_id IS NULL
     OR p_first_status_id IS NULL OR p_assignments IS NULL OR jsonb_typeof(p_assignments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TEMPLATE_IMPORT';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_assignments) AS items(value) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item -> 'activity_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'template_activity_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'consultant_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'explicit') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TEMPLATE_IMPORT';
    END IF;
    BEGIN
      v_activity_id := (v_item ->> 'activity_id')::uuid;
      v_template_activity_id := (v_item ->> 'template_activity_id')::uuid;
      v_consultant_id := (v_item ->> 'consultant_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TEMPLATE_IMPORT';
    END;
    v_explicit := (v_item ->> 'explicit')::boolean;
    IF v_activity_id = ANY(v_activity_ids) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TEMPLATE_IMPORT';
    END IF;
    v_activity_ids := array_append(v_activity_ids, v_activity_id);
    v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
      'activity_id', v_activity_id,
      'template_activity_id', v_template_activity_id,
      'consultant_id', v_consultant_id,
      'explicit', v_explicit
    ));
  END LOOP;

  -- The advisory lock precedes every row lock. Profile locks make account
  -- deactivation wait until this import's eligibility checks and writes finish.
  PERFORM profile.id
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id
     OR profile.id IN (
       SELECT input.consultant_id
       FROM jsonb_to_recordset(v_assignments) AS input(
         activity_id uuid, template_activity_id uuid, consultant_id uuid, explicit boolean
       )
     )
  ORDER BY profile.id
  FOR SHARE OF profile;

  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_PROJECT_MANAGER_REQUIRED';
  END IF;

  SELECT project.template_id
    INTO v_project_template_id
  FROM public.projects AS project
  WHERE project.id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROJECT_NOT_FOUND';
  END IF;
  IF v_project_template_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROJECT_ALREADY_HAS_TEMPLATE';
  END IF;

  IF v_actor.role <> 'admin' THEN
    IF v_actor.role <> 'consultant' OR v_actor.consultant_level IS DISTINCT FROM 'senior' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_PROJECT_MANAGER_REQUIRED';
    END IF;
    SELECT member.id INTO v_member_id
    FROM public.project_members AS member
    WHERE member.project_id = p_project_id
      AND member.consultant_id = p_actor_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_PROJECT_MANAGER_REQUIRED';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.project_templates AS template
    WHERE template.id = p_template_id
      AND template.status = 'published'
      AND template.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TEMPLATE_NOT_AVAILABLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_statuses AS status
    WHERE status.id = p_first_status_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TEMPLATE_IMPORT';
  END IF;

  -- Lock all target activities in stable order before reading their state.
  PERFORM activity.id
  FROM public.project_activities AS activity
  WHERE activity.id = ANY(v_activity_ids)
  ORDER BY activity.id
  FOR UPDATE OF activity;

  FOR v_assignment IN SELECT value FROM jsonb_array_elements(v_assignments) AS items(value) LOOP
    v_activity_id := (v_assignment ->> 'activity_id')::uuid;
    v_template_activity_id := (v_assignment ->> 'template_activity_id')::uuid;
    v_consultant_id := (v_assignment ->> 'consultant_id')::uuid;

    IF NOT EXISTS (
      SELECT 1
      FROM public.project_activities AS activity
      JOIN public.project_phases AS phase ON phase.id = activity.phase_id
      WHERE activity.id = v_activity_id
        AND phase.project_id = p_project_id
        AND activity.source_template_activity_id = v_template_activity_id
        AND activity.visibility = 'draft'
        AND activity.assigned_to IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TEMPLATE_IMPORT_TARGET';
    END IF;

    SELECT * INTO v_assignee FROM public.profiles WHERE id = v_consultant_id;
    v_reason := CASE
      WHEN NOT FOUND THEN 'consultant_not_found'
      WHEN v_assignee.role <> 'consultant' THEN 'not_consultant'
      WHEN v_assignee.is_active IS NOT TRUE THEN 'inactive_consultant'
      ELSE NULL
    END;
    IF v_reason IS NOT NULL THEN
      IF (v_assignment ->> 'explicit')::boolean THEN
        v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
          'activity_id', v_template_activity_id,
          'consultant_id', v_consultant_id,
          'reason', v_reason
        ));
      ELSE
        v_omitted := v_omitted || jsonb_build_array(jsonb_build_object(
          'activity_id', v_activity_id,
          'consultant_id', v_consultant_id,
          'template_activity_id', v_template_activity_id
        ));
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_invalid) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INACTIVE_ASSIGNMENT',
      DETAIL = jsonb_build_object('invalid_assignments', v_invalid)::text;
  END IF;

  FOR v_assignment IN SELECT value FROM jsonb_array_elements(v_assignments) AS items(value) LOOP
    v_activity_id := (v_assignment ->> 'activity_id')::uuid;
    v_template_activity_id := (v_assignment ->> 'template_activity_id')::uuid;
    v_consultant_id := (v_assignment ->> 'consultant_id')::uuid;
    IF v_omitted @> jsonb_build_array(jsonb_build_object('activity_id', v_activity_id)) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.project_members (project_id, consultant_id, role_in_project)
    VALUES (p_project_id, v_consultant_id, 'member')
    ON CONFLICT (project_id, consultant_id) DO NOTHING
    RETURNING id, consultant_id INTO v_member;
    IF FOUND THEN
      v_added_members := v_added_members || jsonb_build_array(jsonb_build_object(
        'id', v_member.id,
        'consultant_id', v_member.consultant_id
      ));
    END IF;

    UPDATE public.project_activities AS activity
    SET assigned_to = v_consultant_id,
        assigned_by = p_actor_id,
        updated_at = clock_timestamp()
    WHERE activity.id = v_activity_id
    RETURNING activity.updated_at INTO v_updated_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TEMPLATE_IMPORT_TARGET';
    END IF;
    v_assigned := v_assigned || jsonb_build_array(jsonb_build_object(
      'id', v_activity_id,
      'consultant_id', v_consultant_id,
      'updated_at', v_updated_at
    ));
  END LOOP;

  UPDATE public.projects
  SET template_id = p_template_id,
      current_status_id = p_first_status_id,
      updated_at = clock_timestamp()
  WHERE id = p_project_id
    AND template_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROJECT_ALREADY_HAS_TEMPLATE';
  END IF;

  RETURN jsonb_build_object(
    'assigned', v_assigned,
    'added_members', v_added_members,
    'omitted', v_omitted
  );
END
$function$;

REVOKE ALL ON FUNCTION public.finalize_template_import(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_template_import(uuid, uuid, uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_duplicate_assignments(
  p_project_id uuid,
  p_actor_id uuid,
  p_activity_assignments jsonb,
  p_document_assignments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_item jsonb;
  v_activity_item jsonb;
  v_document_item jsonb;
  v_id uuid;
  v_consultant_id uuid;
  v_activity_ids uuid[] := ARRAY[]::uuid[];
  v_document_ids uuid[] := ARRAY[]::uuid[];
  v_activity_assignments jsonb := '[]'::jsonb;
  v_document_assignments jsonb := '[]'::jsonb;
  v_activities jsonb := '[]'::jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_omitted jsonb := '[]'::jsonb;
  v_prev_suppressed text;
  v_actor public.profiles%ROWTYPE;
  v_assignee public.profiles%ROWTYPE;
  v_project_id uuid;
  v_member_id uuid;
  v_updated_at timestamptz;
  v_assigned_by uuid;
  v_assigned_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);

  IF p_project_id IS NULL OR p_actor_id IS NULL
     OR p_activity_assignments IS NULL OR jsonb_typeof(p_activity_assignments) IS DISTINCT FROM 'array'
     OR p_document_assignments IS NULL OR jsonb_typeof(p_document_assignments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENTS';
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_activity_assignments) AS items(value)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item -> 'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'consultant_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENTS';
    END IF;
    BEGIN
      v_id := (v_item ->> 'id')::uuid;
      v_consultant_id := (v_item ->> 'consultant_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENTS';
    END;
    IF v_id = ANY(v_activity_ids) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENTS';
    END IF;
    v_activity_ids := array_append(v_activity_ids, v_id);
    v_activity_assignments := v_activity_assignments || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'consultant_id', v_consultant_id
    ));
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_document_assignments) AS items(value)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item -> 'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'consultant_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENTS';
    END IF;
    BEGIN
      v_id := (v_item ->> 'id')::uuid;
      v_consultant_id := (v_item ->> 'consultant_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENTS';
    END;
    IF v_id = ANY(v_document_ids) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENTS';
    END IF;
    v_document_ids := array_append(v_document_ids, v_id);
    v_document_assignments := v_document_assignments || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'consultant_id', v_consultant_id
    ));
  END LOOP;

  PERFORM profile.id
  FROM public.profiles AS profile
  WHERE profile.id = p_actor_id
     OR profile.id IN (
       SELECT input.consultant_id
       FROM jsonb_to_recordset(v_activity_assignments) AS input(id uuid, consultant_id uuid)
       UNION
       SELECT input.consultant_id
       FROM jsonb_to_recordset(v_document_assignments) AS input(id uuid, consultant_id uuid)
     )
  ORDER BY profile.id
  FOR SHARE OF profile;

  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_PROJECT_MEMBER_REQUIRED';
  END IF;

  SELECT project.id INTO v_project_id
  FROM public.projects AS project
  WHERE project.id = p_project_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROJECT_NOT_FOUND';
  END IF;

  IF v_actor.role <> 'admin' THEN
    IF v_actor.role <> 'consultant' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_PROJECT_MEMBER_REQUIRED';
    END IF;
    SELECT member.id INTO v_member_id
    FROM public.project_members AS member
    WHERE member.project_id = p_project_id
      AND member.consultant_id = p_actor_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_PROJECT_MEMBER_REQUIRED';
    END IF;
  END IF;

  PERFORM activity.id
  FROM public.project_activities AS activity
  WHERE activity.id = ANY(v_activity_ids)
  ORDER BY activity.id
  FOR UPDATE OF activity;
  PERFORM requirement.id
  FROM public.document_requirements AS requirement
  WHERE requirement.id = ANY(v_document_ids)
  ORDER BY requirement.id
  FOR UPDATE OF requirement;

  IF (
    SELECT count(*)
    FROM public.project_activities AS activity
    JOIN public.project_phases AS phase ON phase.id = activity.phase_id
    WHERE activity.id = ANY(v_activity_ids)
      AND phase.project_id = p_project_id
      AND activity.visibility = 'draft'
      AND activity.assigned_to IS NULL
  ) <> cardinality(v_activity_ids) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENT_TARGET';
  END IF;
  IF (
    SELECT count(*)
    FROM public.document_requirements AS requirement
    WHERE requirement.id = ANY(v_document_ids)
      AND requirement.project_id = p_project_id
      AND requirement.visibility = 'draft'
      AND requirement.deleted_at IS NULL
      AND requirement.assigned_to IS NULL
  ) <> cardinality(v_document_ids) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENT_TARGET';
  END IF;

  v_prev_suppressed := current_setting('app.skip_assignment_notifications', true);
  PERFORM set_config('app.skip_assignment_notifications', 'on', true);

  FOR v_activity_item IN
    SELECT value FROM jsonb_array_elements(v_activity_assignments) AS items(value)
  LOOP
    v_id := (v_activity_item ->> 'id')::uuid;
    v_consultant_id := (v_activity_item ->> 'consultant_id')::uuid;
    SELECT * INTO v_assignee FROM public.profiles WHERE id = v_consultant_id;
    IF NOT FOUND OR v_assignee.is_active IS NOT TRUE THEN
      v_omitted := v_omitted || jsonb_build_array(jsonb_build_object(
        'entity_type', 'activity', 'entity_id', v_id, 'consultant_id', v_consultant_id
      ));
      CONTINUE;
    END IF;

    UPDATE public.project_activities AS activity
    SET assigned_to = v_consultant_id,
        assigned_by = p_actor_id,
        updated_at = clock_timestamp()
    WHERE activity.id = v_id
    RETURNING activity.assigned_by, activity.updated_at
      INTO v_assigned_by, v_updated_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENT_TARGET';
    END IF;
    v_activities := v_activities || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'assigned_to', v_consultant_id,
      'assigned_by', v_assigned_by,
      'updated_at', v_updated_at
    ));
  END LOOP;

  FOR v_document_item IN
    SELECT value FROM jsonb_array_elements(v_document_assignments) AS items(value)
  LOOP
    v_id := (v_document_item ->> 'id')::uuid;
    v_consultant_id := (v_document_item ->> 'consultant_id')::uuid;
    SELECT * INTO v_assignee FROM public.profiles WHERE id = v_consultant_id;
    IF NOT FOUND OR v_assignee.is_active IS NOT TRUE THEN
      v_omitted := v_omitted || jsonb_build_array(jsonb_build_object(
        'entity_type', 'document_request', 'entity_id', v_id, 'consultant_id', v_consultant_id
      ));
      CONTINUE;
    END IF;

    UPDATE public.document_requirements AS requirement
    SET assigned_to = v_consultant_id,
        assigned_by = p_actor_id,
        assigned_at = clock_timestamp()
    WHERE requirement.id = v_id
    RETURNING requirement.assigned_by, requirement.assigned_at
      INTO v_assigned_by, v_assigned_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DUPLICATE_ASSIGNMENT_TARGET';
    END IF;
    v_documents := v_documents || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'assigned_to', v_consultant_id,
      'assigned_by', v_assigned_by,
      'assigned_at', v_assigned_at
    ));
  END LOOP;

  PERFORM set_config('app.skip_assignment_notifications', COALESCE(v_prev_suppressed, 'off'), true);

  RETURN jsonb_build_object(
    'activities', v_activities,
    'documents', v_documents,
    'omitted', v_omitted
  );
END
$function$;

REVOKE ALL ON FUNCTION public.apply_duplicate_assignments(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_duplicate_assignments(uuid, uuid, jsonb, jsonb) TO service_role;
-- Every new profile relationship is checked while holding the same lock used by
-- lifecycle operations. Existing references are left untouched when other
-- columns are edited.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_id uuid;
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND conname = 'notifications_actor_id_fkey'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_actor_id_fkey
      FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
  END IF;
END
$migration$;
CREATE INDEX IF NOT EXISTS notifications_actor_id_idx
  ON public.notifications (actor_id)
  WHERE actor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue105_acquire_account_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_acquire_account_lock() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue105_guard_active_profile_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid;
  v_is_active boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) -> TG_ARGV[0]) IS NOT DISTINCT FROM (to_jsonb(OLD) -> TG_ARGV[0]) THEN
    RETURN NEW;
  END IF;

  v_user_id := nullif(to_jsonb(NEW) ->> TG_ARGV[0], '')::uuid;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile.is_active INTO v_is_active
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id
  FOR SHARE;
  IF NOT FOUND THEN
    -- Let the foreign key report a missing profile; this guard is for inactive
    -- references and does not replace referential integrity.
    RETURN NEW;
  END IF;
  IF v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INACTIVE_REFERENCE',
      DETAIL = jsonb_build_object('user_id', v_user_id, 'field', TG_ARGV[0])::text;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_guard_active_profile_reference() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue105_guard_audit_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = NEW.user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUDIT_AUTHOR_PROFILE_REQUIRED';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_guard_audit_author() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.issue105_guard_last_active_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' AND OLD.is_active IS TRUE
       AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active IS TRUE) <= 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ACTIVE_ADMIN';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.role = 'admin'
     AND OLD.is_active IS TRUE
     AND (NEW.role IS DISTINCT FROM 'admin' OR NEW.is_active IS DISTINCT FROM true)
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active IS TRUE) <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ACTIVE_ADMIN';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_guard_last_active_admin() FROM PUBLIC, anon, authenticated;

DO $triggers$
DECLARE
  v_table record;
  v_reference record;
  v_trigger_name text;
BEGIN
  FOR v_table IN
    SELECT child_schema, child_table
    FROM (
      SELECT DISTINCT child_ns.nspname AS child_schema, child.relname AS child_table
      FROM pg_constraint AS fk
      JOIN pg_class AS child ON child.oid = fk.conrelid
      JOIN pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
      WHERE fk.contype = 'f'
        AND fk.confrelid = 'public.profiles'::regclass
        AND child_ns.nspname = 'public'
      UNION
      SELECT 'public'::name, 'audit_logs'::name
      WHERE to_regclass('public.audit_logs') IS NOT NULL
    ) AS lock_tables
    ORDER BY child_schema, child_table
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = format('%I.%I', v_table.child_schema, v_table.child_table)::regclass
        AND tgname = 'issue105_account_lock'
        AND NOT tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER issue105_account_lock BEFORE INSERT OR UPDATE OR DELETE ON %I.%I ' ||
        'FOR EACH STATEMENT EXECUTE FUNCTION public.issue105_acquire_account_lock()',
        v_table.child_schema, v_table.child_table
      );
    END IF;
  END LOOP;

  FOR v_reference IN
    SELECT child_ns.nspname AS child_schema,
           child.relname AS child_table,
           child_attr.attname AS child_column,
           fk.conname AS constraint_name
    FROM pg_constraint AS fk
    JOIN pg_class AS child ON child.oid = fk.conrelid
    JOIN pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
    JOIN unnest(fk.conkey, fk.confkey) WITH ORDINALITY AS keys(child_attnum, parent_attnum, ord) ON true
    JOIN pg_attribute AS child_attr
      ON child_attr.attrelid = fk.conrelid AND child_attr.attnum = keys.child_attnum
    JOIN pg_attribute AS parent_attr
      ON parent_attr.attrelid = fk.confrelid AND parent_attr.attnum = keys.parent_attnum
    WHERE fk.contype = 'f'
      AND fk.confrelid = 'public.profiles'::regclass
      AND child_ns.nspname = 'public'
      AND cardinality(fk.conkey) = 1
      AND cardinality(fk.confkey) = 1
      AND parent_attr.attname = 'id'
      AND ((child.relname = 'projects' AND child_attr.attname IN ('client_id', 'general_consultant_id'))
        OR (child.relname = 'project_members' AND child_attr.attname = 'consultant_id')
        OR (child.relname = 'project_activities' AND child_attr.attname = 'assigned_to')
        OR (child.relname = 'document_requirements' AND child_attr.attname = 'assigned_to')
        OR (child.relname = 'template_activities' AND child_attr.attname = 'default_consultant_id')
        OR (child.relname = 'private_conversation_participants' AND child_attr.attname = 'user_id'))
    ORDER BY child_ns.nspname, child.relname, child_attr.attname, fk.conname
  LOOP
    v_trigger_name := 'issue105_ref_' || substr(md5(
      v_reference.child_schema || '.' || v_reference.child_table || '.' ||
      v_reference.child_column || '.' || v_reference.constraint_name
    ), 1, 16);
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = format('%I.%I', v_reference.child_schema, v_reference.child_table)::regclass
        AND tgname = v_trigger_name
        AND NOT tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I.%I ' ||
        'FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_active_profile_reference(%L)',
        v_trigger_name,
        v_reference.child_column,
        v_reference.child_schema,
        v_reference.child_table,
        v_reference.child_column
      );
    END IF;
  END LOOP;
END
$triggers$;
CREATE TRIGGER issue105_audit_author_guard
BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_audit_author();

CREATE TRIGGER issue105_profiles_account_lock
BEFORE UPDATE OF role, is_active OR DELETE ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION public.issue105_acquire_account_lock();
CREATE TRIGGER issue105_last_active_admin
BEFORE UPDATE OF role, is_active ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_last_active_admin();
CREATE TRIGGER issue105_last_active_admin_delete
BEFORE DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_last_active_admin();

CREATE OR REPLACE FUNCTION public.issue105_guard_private_message_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid;
  v_is_active boolean;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT reference.user_id
    FROM (
      SELECT NEW.created_by AS user_id
      UNION ALL
      SELECT participant.user_id
      FROM public.private_conversation_participants AS participant
      WHERE participant.conversation_id = NEW.conversation_id
    ) AS reference
    WHERE reference.user_id IS NOT NULL
    ORDER BY reference.user_id
  LOOP
    SELECT profile.is_active INTO v_is_active
    FROM public.profiles AS profile
    WHERE profile.id = v_user_id
    FOR SHARE;
    IF FOUND AND v_is_active IS NOT TRUE THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'INACTIVE_REFERENCE',
        DETAIL = jsonb_build_object('user_id', v_user_id, 'field', 'private_chat_participant')::text;
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_guard_private_message_participants() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER issue105_private_message_active_participants
BEFORE INSERT ON public.private_messages
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_private_message_participants();
CREATE TRIGGER issue105_conversation_active_creator
BEFORE INSERT ON public.private_conversations
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_active_profile_reference('created_by');
CREATE TRIGGER issue105_project_chat_active_creator
BEFORE INSERT ON public.project_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_active_profile_reference('created_by');
CREATE OR REPLACE FUNCTION public.issue105_guard_publication_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid;
  v_is_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.visibility = 'published' OR NEW.visibility IS DISTINCT FROM 'published' THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.visibility IS DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'project_activities' THEN
    v_user_id := NEW.assigned_to;
  ELSIF TG_TABLE_NAME = 'document_requirements' THEN
    IF NEW.is_outgoing IS TRUE THEN
      RETURN NEW;
    END IF;
    v_user_id := NEW.assigned_to;
    IF v_user_id IS NULL AND NEW.activity_id IS NOT NULL THEN
      SELECT activity.assigned_to INTO v_user_id
      FROM public.project_activities AS activity
      WHERE activity.id = NEW.activity_id;
    ELSIF v_user_id IS NULL AND NEW.activity_id IS NULL AND NEW.project_id IS NOT NULL THEN
      SELECT project.general_consultant_id INTO v_user_id
      FROM public.projects AS project
      WHERE project.id = NEW.project_id
        AND EXISTS (
          SELECT 1 FROM public.project_members AS member
          WHERE member.project_id = project.id
            AND member.consultant_id = project.general_consultant_id
        );
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile.is_active
    INTO v_is_active
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id
  FOR SHARE;
  IF NOT FOUND OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INACTIVE_REFERENCE',
      DETAIL = jsonb_build_object('user_id', v_user_id, 'field', 'publication_assignee')::text;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_guard_publication_assignee() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER issue105_activity_publication_assignee
BEFORE INSERT OR UPDATE OF visibility ON public.project_activities
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_publication_assignee();
CREATE TRIGGER issue105_document_publication_assignee
BEFORE INSERT OR UPDATE OF visibility ON public.document_requirements
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_publication_assignee();

DO $storage_compat$
BEGIN
  IF to_regclass('storage.objects') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'storage' AND table_name = 'objects'
         AND column_name = 'owner' AND data_type = 'uuid'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'storage' AND table_name = 'objects'
         AND column_name = 'owner_id' AND data_type = 'text'
     ) THEN
    RAISE EXCEPTION 'Incompatible Storage schema: storage.objects.owner UUID and owner_id text are required';
  END IF;
  IF NOT has_table_privilege('postgres', 'storage.objects', 'SELECT')
     OR NOT has_table_privilege('postgres', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'Incompatible privileges: postgres requires Storage object and profile read access';
  END IF;
END
$storage_compat$;

CREATE OR REPLACE FUNCTION public.issue105_guard_storage_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
  v_locked_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.owner IS NOT DISTINCT FROM OLD.owner
     AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    RETURN NEW;
  END IF;
  IF NEW.owner IS NOT NULL AND nullif(NEW.owner_id, '') IS NOT NULL
     AND NEW.owner IS DISTINCT FROM NEW.owner_id::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STORAGE_OWNER_MISMATCH';
  END IF;
  v_owner_id := coalesce(NEW.owner, nullif(NEW.owner_id, '')::uuid);
  IF v_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile.id INTO v_locked_id
  FROM public.profiles AS profile
  WHERE profile.id = v_owner_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STORAGE_OWNER_PROFILE_REQUIRED';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_guard_storage_owner() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER issue105_storage_account_lock
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH STATEMENT EXECUTE FUNCTION public.issue105_acquire_account_lock();
CREATE TRIGGER issue105_storage_owner_guard
BEFORE INSERT OR UPDATE OF owner, owner_id ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_storage_owner();
CREATE OR REPLACE FUNCTION public.issue105_capture_notification_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_actor_text text;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    v_actor_text := nullif(current_setting('app.issue105_notification_actor_id', true), '');
    IF v_actor_text IS NOT NULL THEN
      BEGIN
        v_actor_id := v_actor_text::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid notification actor context' USING ERRCODE = 'P0001';
      END;
    ELSE
      v_actor_id := NEW.actor_id;
    END IF;
  END IF;
  IF v_actor_id IS NOT NULL THEN
    NEW.actor_id := v_actor_id;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_capture_notification_actor() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER issue105_notification_actor
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.issue105_capture_notification_actor();

CREATE OR REPLACE FUNCTION public.notify_document_request_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_previous_actor text;
  v_actor_id uuid;
BEGIN
  IF public.assignment_notifications_suppressed() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  v_actor_id := COALESCE(auth.uid(), NEW.assigned_by);
  v_previous_actor := current_setting('app.issue105_notification_actor_id', true);
  PERFORM set_config('app.issue105_notification_actor_id', COALESCE(v_actor_id::text, ''), true);

  PERFORM public.insert_notification_event(
    NEW.project_id,
    'assignment',
    'document_request',
    NEW.id,
    'Cerere de document atribuită',
    1,
    format(
      'assignment-v2:%s:%s:%s:%s:%s',
      NEW.project_id,
      NEW.id,
      NEW.assigned_to,
      COALESCE(OLD.assigned_to::text, 'none'),
      txid_current()
    ),
    NEW.assigned_to,
    true,
    false,
    true,
    'info',
    (
      SELECT COALESCE(nullif(btrim(actor.full_name), ''), actor.email)
      FROM public.profiles AS actor
      WHERE actor.id = v_actor_id
    ),
    COALESCE(NEW.name, NEW.id::text)
  );

  PERFORM set_config('app.issue105_notification_actor_id', COALESCE(v_previous_actor, ''), true);
  RETURN NEW;
END
$function$;
ALTER FUNCTION public.notify_document_request_assignment() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_document_request_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_document_request_assignment() TO service_role;

CREATE OR REPLACE FUNCTION public.notify_project_activity_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_project_id uuid;
  v_previous_actor text;
  v_actor_id uuid;
BEGIN
  IF public.assignment_notifications_suppressed() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT phase.project_id
    INTO v_project_id
  FROM public.project_phases AS phase
  WHERE phase.id = NEW.phase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project phase not found' USING ERRCODE = 'P0001';
  END IF;

  v_actor_id := COALESCE(auth.uid(), NEW.assigned_by);
  v_previous_actor := current_setting('app.issue105_notification_actor_id', true);
  PERFORM set_config('app.issue105_notification_actor_id', COALESCE(v_actor_id::text, ''), true);

  PERFORM public.insert_notification_event(
    v_project_id,
    'assignment',
    'activity',
    NEW.id,
    'Activitate atribuită',
    1,
    format(
      'assignment-v2:%s:%s:%s:%s:%s',
      v_project_id,
      NEW.id,
      NEW.assigned_to,
      COALESCE(OLD.assigned_to::text, 'none'),
      txid_current()
    ),
    NEW.assigned_to,
    true,
    false,
    true,
    'info',
    (
      SELECT COALESCE(nullif(btrim(actor.full_name), ''), actor.email)
      FROM public.profiles AS actor
      WHERE actor.id = v_actor_id
    ),
    COALESCE(NEW.name, NEW.id::text)
  );

  PERFORM set_config('app.issue105_notification_actor_id', COALESCE(v_previous_actor, ''), true);
  RETURN NEW;
END
$function$;
ALTER FUNCTION public.notify_project_activity_assignment() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notify_project_activity_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_project_activity_assignment() TO service_role;

DO $notification_rpc_compat$
BEGIN
  IF to_regprocedure('public.complete_reserved_document_upload_batch(uuid,uuid,jsonb,text)') IS NULL
     OR to_regprocedure('public.review_document_request(uuid,text,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Incompatible notification producer RPC schema';
  END IF;
END
$notification_rpc_compat$;

ALTER FUNCTION public.complete_reserved_document_upload_batch(uuid, uuid, jsonb, text)
  RENAME TO complete_reserved_document_upload_batch_issue105_legacy;
ALTER FUNCTION public.review_document_request(uuid, text, text, uuid, text)
  RENAME TO review_document_request_issue105_legacy;

REVOKE ALL ON FUNCTION public.complete_reserved_document_upload_batch_issue105_legacy(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.review_document_request_issue105_legacy(uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_reserved_document_upload_batch(
  p_upload_batch_id uuid,
  p_actor_id uuid,
  p_selected_file_ids jsonb,
  p_ip_address text DEFAULT NULL
)
RETURNS TABLE(created boolean, version_number integer, file_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_previous_actor text;
  v_actor_id uuid;
  v_locked_actor uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  v_actor_id := COALESCE(auth.uid(), p_actor_id);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_SESSION_INACTIVE';
  END IF;
  SELECT profile.id INTO v_locked_actor
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id AND profile.is_active IS TRUE
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_SESSION_INACTIVE';
  END IF;
  v_previous_actor := current_setting('app.issue105_notification_actor_id', true);
  PERFORM set_config('app.issue105_notification_actor_id', v_actor_id::text, true);
  RETURN QUERY
  SELECT result.created, result.version_number, result.file_count
  FROM public.complete_reserved_document_upload_batch_issue105_legacy(
    p_upload_batch_id, p_actor_id, p_selected_file_ids, p_ip_address
  ) AS result;
  PERFORM set_config('app.issue105_notification_actor_id', COALESCE(v_previous_actor, ''), true);
END
$function$;
ALTER FUNCTION public.complete_reserved_document_upload_batch(uuid, uuid, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_reserved_document_upload_batch(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_reserved_document_upload_batch(uuid, uuid, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.review_document_request(
  p_request_id uuid,
  p_action text,
  p_reason text DEFAULT NULL,
  p_reviewed_by uuid DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS TABLE(created boolean, review_id uuid, reviewed_version_number integer, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_previous_actor text;
  v_actor_id uuid;
  v_locked_actor uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  v_actor_id := COALESCE(auth.uid(), p_reviewed_by);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_SESSION_INACTIVE';
  END IF;
  SELECT profile.id INTO v_locked_actor
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id AND profile.is_active IS TRUE
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_SESSION_INACTIVE';
  END IF;
  v_previous_actor := current_setting('app.issue105_notification_actor_id', true);
  PERFORM set_config('app.issue105_notification_actor_id', v_actor_id::text, true);
  RETURN QUERY
  SELECT result.created, result.review_id, result.reviewed_version_number, result.action
  FROM public.review_document_request_issue105_legacy(
    p_request_id, p_action, p_reason, p_reviewed_by, p_ip_address
  ) AS result;
  PERFORM set_config('app.issue105_notification_actor_id', COALESCE(v_previous_actor, ''), true);
END
$function$;
ALTER FUNCTION public.review_document_request(uuid, text, text, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_document_request(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_document_request(uuid, text, text, uuid, text) TO service_role;
CREATE OR REPLACE FUNCTION public.issue105_guard_notification_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_is_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;

  SELECT profile.is_active INTO v_is_active
  FROM public.profiles AS profile
  WHERE profile.id = NEW.user_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF v_is_active IS NOT TRUE THEN
    -- A deactivation racing an insert drops that recipient row instead of
    -- failing the underlying business write.
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.issue105_guard_notification_recipient() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER issue105_00_notification_recipient
BEFORE INSERT OR UPDATE OF user_id ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.issue105_guard_notification_recipient();
CREATE OR REPLACE FUNCTION public.delete_project_activity_preserving_requests(
  project_id uuid,
  phase_id uuid,
  activity_id uuid
)
RETURNS TABLE(deleted boolean, moved_requests integer, demoted_requests integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_phase_visibility text;
  v_activity_visibility text;
  v_activity_assigned_to uuid;
  v_moved_count integer;
  v_demoted_count integer;
  v_previous_suppressed text;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);

  SELECT phase.visibility INTO v_phase_visibility
  FROM public.project_phases AS phase
  WHERE phase.id = $2 AND phase.project_id = $1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project phase not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT activity.visibility, activity.assigned_to
    INTO v_activity_visibility, v_activity_assigned_to
  FROM public.project_activities AS activity
  WHERE activity.id = $3 AND activity.phase_id = $2
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project activity not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM requirement.id
  FROM public.document_requirements AS requirement
  WHERE requirement.project_id = $1 AND requirement.activity_id = $3
  ORDER BY requirement.id
  FOR UPDATE;

  SELECT count(*)::integer INTO v_moved_count
  FROM public.document_requirements AS requirement
  WHERE requirement.project_id = $1
    AND requirement.activity_id = $3
    AND requirement.deleted_at IS NULL;

  SELECT count(*)::integer INTO v_demoted_count
  FROM public.document_requirements AS requirement
  WHERE requirement.project_id = $1
    AND requirement.activity_id = $3
    AND requirement.deleted_at IS NULL
    AND requirement.visibility = 'published'
    AND (v_activity_visibility <> 'published' OR v_phase_visibility <> 'published');

  v_previous_suppressed := current_setting('app.skip_assignment_notifications', true);
  PERFORM set_config('app.skip_assignment_notifications', 'on', true);
  UPDATE public.document_requirements AS requirement
  SET activity_id = NULL,
      visibility = CASE
        WHEN requirement.visibility = 'published'
          AND v_activity_visibility = 'published'
          AND v_phase_visibility = 'published' THEN 'published'
        ELSE 'draft'
      END,
      assigned_to = CASE
        WHEN requirement.assigned_to IS NOT NULL THEN requirement.assigned_to
        WHEN v_activity_assigned_to IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.project_members AS member
          JOIN public.profiles AS profile ON profile.id = member.consultant_id
          WHERE member.project_id = $1
            AND member.consultant_id = v_activity_assigned_to
            AND profile.role = 'consultant'
            AND profile.is_active IS TRUE
        ) THEN v_activity_assigned_to
        ELSE NULL
      END
  WHERE requirement.project_id = $1
    AND requirement.activity_id = $3
    AND requirement.deleted_at IS NULL;
  PERFORM set_config('app.skip_assignment_notifications', COALESCE(v_previous_suppressed, 'off'), true);

  UPDATE public.document_requirements AS requirement
  SET activity_id = NULL
  WHERE requirement.project_id = $1
    AND requirement.activity_id = $3
    AND requirement.deleted_at IS NOT NULL;

  DELETE FROM public.project_activities AS activity
  WHERE activity.id = $3 AND activity.phase_id = $2;
  RETURN QUERY SELECT true, v_moved_count, v_demoted_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.delete_project_phase_preserving_requests(
  project_id uuid,
  phase_id uuid
)
RETURNS TABLE(deleted boolean, deleted_activities integer, moved_requests integer, demoted_requests integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_phase_visibility text;
  v_deleted_activity_count integer;
  v_moved_count integer;
  v_demoted_count integer;
  v_previous_suppressed text;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);

  SELECT phase.visibility INTO v_phase_visibility
  FROM public.project_phases AS phase
  WHERE phase.id = $2 AND phase.project_id = $1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project phase not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM activity.id
  FROM public.project_activities AS activity
  WHERE activity.phase_id = $2
  ORDER BY activity.id
  FOR UPDATE;

  PERFORM requirement.id
  FROM public.document_requirements AS requirement
  JOIN public.project_activities AS activity ON activity.id = requirement.activity_id
  WHERE requirement.project_id = $1 AND activity.phase_id = $2
  ORDER BY requirement.id
  FOR UPDATE OF requirement;

  SELECT count(*)::integer INTO v_deleted_activity_count
  FROM public.project_activities AS activity
  WHERE activity.phase_id = $2;

  SELECT count(*)::integer INTO v_moved_count
  FROM public.document_requirements AS requirement
  JOIN public.project_activities AS activity ON activity.id = requirement.activity_id
  WHERE requirement.project_id = $1
    AND activity.phase_id = $2
    AND requirement.deleted_at IS NULL;

  SELECT count(*)::integer INTO v_demoted_count
  FROM public.document_requirements AS requirement
  JOIN public.project_activities AS activity ON activity.id = requirement.activity_id
  WHERE requirement.project_id = $1
    AND activity.phase_id = $2
    AND requirement.deleted_at IS NULL
    AND requirement.visibility = 'published'
    AND (activity.visibility <> 'published' OR v_phase_visibility <> 'published');

  v_previous_suppressed := current_setting('app.skip_assignment_notifications', true);
  PERFORM set_config('app.skip_assignment_notifications', 'on', true);
  UPDATE public.document_requirements AS requirement
  SET activity_id = NULL,
      visibility = CASE
        WHEN requirement.visibility = 'published'
          AND activity.visibility = 'published'
          AND v_phase_visibility = 'published' THEN 'published'
        ELSE 'draft'
      END,
      assigned_to = CASE
        WHEN requirement.assigned_to IS NOT NULL THEN requirement.assigned_to
        WHEN activity.assigned_to IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.project_members AS member
          JOIN public.profiles AS profile ON profile.id = member.consultant_id
          WHERE member.project_id = $1
            AND member.consultant_id = activity.assigned_to
            AND profile.role = 'consultant'
            AND profile.is_active IS TRUE
        ) THEN activity.assigned_to
        ELSE NULL
      END
  FROM public.project_activities AS activity
  WHERE requirement.project_id = $1
    AND requirement.activity_id = activity.id
    AND activity.phase_id = $2
    AND requirement.deleted_at IS NULL;
  PERFORM set_config('app.skip_assignment_notifications', COALESCE(v_previous_suppressed, 'off'), true);

  UPDATE public.document_requirements AS requirement
  SET activity_id = NULL
  FROM public.project_activities AS activity
  WHERE requirement.project_id = $1
    AND requirement.activity_id = activity.id
    AND activity.phase_id = $2
    AND requirement.deleted_at IS NOT NULL;

  DELETE FROM public.project_activities AS activity WHERE activity.phase_id = $2;
  DELETE FROM public.project_phases AS phase WHERE phase.id = $2 AND phase.project_id = $1;
  RETURN QUERY SELECT true, v_deleted_activity_count, v_moved_count, v_demoted_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.finalize_reminder_claim(
  p_log_id uuid,
  p_claim_token uuid,
  p_provider_id text
)
RETURNS TABLE(finalized boolean, skipped_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_claim public.reminder_log%ROWTYPE;
  v_skipped integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT * INTO v_claim
  FROM public.reminder_log
  WHERE id = p_log_id AND status = 'claimed' AND claim_token = p_claim_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  UPDATE public.reminder_log
  SET status = 'sent', provider_id = p_provider_id, sent_at = clock_timestamp(),
      claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
  WHERE id = v_claim.id;

  WITH thresholds(threshold, urgency_rank) AS (
    VALUES ('1_week', 1), ('3_days', 2), ('1_day', 3), ('same_day', 4), ('overdue', 5)
  )
  INSERT INTO public.reminder_log (
    entity_type, entity_id, project_id, recipient_id, recipient_email,
    recipient_kind, threshold, deadline_at, status, source, triggered_by,
    run_id, send_index, skip_reason, created_at
  )
  SELECT v_claim.entity_type, v_claim.entity_id, v_claim.project_id, v_claim.recipient_id,
         v_claim.recipient_email, v_claim.recipient_kind, less.threshold,
         v_claim.deadline_at, 'skipped', v_claim.source, v_claim.triggered_by,
         v_claim.run_id, 0, 'threshold_consumed', clock_timestamp()
  FROM thresholds AS sent
  JOIN thresholds AS less ON less.urgency_rank < sent.urgency_rank
  WHERE sent.threshold = v_claim.threshold
  ON CONFLICT (entity_type, entity_id, recipient_id, threshold, deadline_at, send_index) DO NOTHING;

  GET DIAGNOSTICS v_skipped = ROW_COUNT;
  RETURN QUERY SELECT true, v_skipped;
END
$function$;

CREATE OR REPLACE FUNCTION public.remove_project_member_if_unassigned(
  p_project_id uuid,
  p_member_id uuid
)
RETURNS TABLE(removed boolean, consultant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_project_general_consultant_id uuid;
  v_member_consultant_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT project.general_consultant_id INTO v_project_general_consultant_id
  FROM public.projects AS project
  WHERE project.id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT member.consultant_id INTO v_member_consultant_id
  FROM public.project_members AS member
  WHERE member.id = p_member_id AND member.project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project member not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM activity.id
  FROM public.project_activities AS activity
  JOIN public.project_phases AS phase ON phase.id = activity.phase_id
  WHERE phase.project_id = p_project_id
  ORDER BY activity.id
  FOR UPDATE;
  PERFORM requirement.id
  FROM public.document_requirements AS requirement
  WHERE requirement.project_id = p_project_id AND requirement.deleted_at IS NULL
  ORDER BY requirement.id
  FOR UPDATE;

  IF v_project_general_consultant_id = v_member_consultant_id THEN
    RAISE EXCEPTION 'Cannot remove this consultant while they are the project general consultant. Reassign the project first.'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.project_activities AS activity
    JOIN public.project_phases AS phase ON phase.id = activity.phase_id
    WHERE phase.project_id = p_project_id AND activity.assigned_to = v_member_consultant_id
  ) THEN
    RAISE EXCEPTION 'Cannot remove this consultant while they are assigned to an activity. Reassign the activity first.'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.document_requirements AS requirement
    WHERE requirement.project_id = p_project_id
      AND requirement.deleted_at IS NULL
      AND requirement.assigned_to = v_member_consultant_id
  ) THEN
    RAISE EXCEPTION 'Cannot remove this consultant while they are assigned to an active document request. Reassign the request first.'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.project_members AS member
  WHERE member.id = p_member_id AND member.project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project member not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY SELECT true, v_member_consultant_id;
END
$function$;
CREATE OR REPLACE FUNCTION public.notification_unread_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_summary jsonb;
BEGIN
  IF NOT public.current_account_session_active() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_SESSION_INACTIVE';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('projectId', totals.project_id, 'count', totals.unread_count)
      ORDER BY totals.project_id
    ),
    '[]'::jsonb
  )
  INTO v_summary
  FROM (
    SELECT n.project_id, count(*)::bigint AS unread_count
    FROM public.notifications AS n
    WHERE n.user_id = auth.uid()
      AND n.read_at IS NULL
      AND n.dismissed_at IS NULL
      AND public.can_select_notification(n.project_id, n.entity_type, n.entity_id)
    GROUP BY n.project_id
  ) AS totals;
  RETURN v_summary;
END
$function$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL::uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_updated_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  IF NOT public.current_account_session_active() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_SESSION_INACTIVE';
  END IF;
  IF p_ids IS NOT NULL AND COALESCE(array_length(p_ids, 1), 0) > 500 THEN
    RAISE EXCEPTION 'Too many notification ids' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.notifications AS n
  SET read_at = now()
  WHERE n.user_id = auth.uid()
    AND n.read_at IS NULL
    AND n.dismissed_at IS NULL
    AND (p_ids IS NULL OR n.id = ANY (p_ids))
    AND public.can_select_notification(n.project_id, n.entity_type, n.entity_id);
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.mark_notifications_unread(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_updated_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  IF NOT public.current_account_session_active() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_SESSION_INACTIVE';
  END IF;
  IF p_ids IS NULL OR COALESCE(array_length(p_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;
  IF array_length(p_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Too many notification ids' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.notifications AS n
  SET read_at = NULL
  WHERE n.user_id = auth.uid()
    AND n.read_at IS NOT NULL
    AND n.dismissed_at IS NULL
    AND n.id = ANY (p_ids)
    AND public.can_select_notification(n.project_id, n.entity_type, n.entity_id);
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_notifications(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_updated_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(105, 1);
  IF NOT public.current_account_session_active() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_SESSION_INACTIVE';
  END IF;
  IF p_ids IS NULL OR COALESCE(array_length(p_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;
  IF array_length(p_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Too many notification ids' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.notifications AS n
  SET dismissed_at = now(),
      read_at = COALESCE(n.read_at, now())
  WHERE n.user_id = auth.uid()
    AND n.dismissed_at IS NULL
    AND n.id = ANY (p_ids)
    AND public.can_select_notification(n.project_id, n.entity_type, n.entity_id);
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END
$function$;

DO $issue105_access_compat$
DECLARE
  v_table record;
  v_view record;
  v_function record;
  v_using_expression text;
BEGIN
  IF to_regprocedure('public.current_account_session_active()') IS NULL THEN
    RAISE EXCEPTION 'Missing current_account_session_active()';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public', 'storage')
      AND relation.relkind IN ('r', 'p')
      AND (has_table_privilege('authenticated', relation.oid, 'SELECT')
        OR has_table_privilege('authenticated', relation.oid, 'INSERT')
        OR has_table_privilege('authenticated', relation.oid, 'UPDATE')
        OR has_table_privilege('authenticated', relation.oid, 'DELETE'))
      AND relation.relrowsecurity IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Authenticated-accessible public/storage table has RLS disabled';
  END IF;

  FOR v_table IN
    SELECT namespace.nspname AS table_schema, relation.relname AS table_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public', 'storage')
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
      AND (
        namespace.nspname = 'public'
        OR EXISTS (
          SELECT 1
          FROM pg_policy AS access_policy
          WHERE access_policy.polrelid = relation.oid
            AND access_policy.polpermissive
            AND access_policy.polcmd IN ('*', 'r', 'a', 'w', 'd')
            AND (
              0 = ANY (access_policy.polroles)
              OR EXISTS (
                SELECT 1
                FROM unnest(access_policy.polroles) AS policy_role(role_oid)
                JOIN pg_roles AS policy_role_info ON policy_role_info.oid = policy_role.role_oid
                WHERE pg_has_role('authenticated'::name, policy_role_info.oid, 'USAGE')
              )
            )
        )
      )
      AND (has_table_privilege('authenticated', relation.oid, 'SELECT')
        OR has_table_privilege('authenticated', relation.oid, 'INSERT')
        OR has_table_privilege('authenticated', relation.oid, 'UPDATE')
        OR has_table_privilege('authenticated', relation.oid, 'DELETE'))
    ORDER BY namespace.nspname, relation.relname
  LOOP
    v_using_expression := CASE
      WHEN v_table.table_schema = 'public' AND v_table.table_name = 'profiles'
        THEN 'public.current_account_session_active() OR (id = auth.uid())'
      ELSE 'public.current_account_session_active()'
    END;
    EXECUTE format(
      'CREATE POLICY issue105_account_session ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (public.current_account_session_active())',
      v_table.table_schema, v_table.table_name, v_using_expression
    );
  END LOOP;

  FOR v_view IN
    SELECT relation.relname AS view_name
    FROM (VALUES ('measure_sessions_stats'), ('project_stats'), ('measures_overview')) AS expected(view_name)
    JOIN pg_class AS relation ON relation.relname = expected.view_name
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('v', 'm')
      AND (has_table_privilege('anon', relation.oid, 'SELECT')
        OR has_table_privilege('authenticated', relation.oid, 'SELECT'))
  LOOP
    EXECUTE format(
      'REVOKE SELECT ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_view.view_name
    );
  END LOOP;

  FOR v_function IN
    SELECT procedure.oid
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef
      AND procedure.proname NOT IN (
        'current_account_session_active',
        'is_admin',
        'is_project_client',
        'can_select_notification',
        'can_select_project_chat_read',
        'get_my_role',
        'can_access_project',
        'notification_unread_summary',
        'mark_notifications_read',
        'mark_notifications_unread',
        'dismiss_notifications'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function.oid::regprocedure
    );
  END LOOP;
END
$issue105_access_compat$;

REVOKE ALL ON FUNCTION public.current_account_session_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_account_session_active() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_access_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_project(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_project_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_client(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_select_notification(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_select_notification(uuid, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_select_project_chat_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_select_project_chat_read(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.notification_unread_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_unread_summary() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_notifications_unread(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_unread(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.dismiss_notifications(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_notifications(uuid[]) TO authenticated, service_role;

DO $issue105_realtime_publication$
BEGIN
  IF to_regclass('public.private_conversations') IS NULL
     OR to_regclass('public.private_conversation_participants') IS NULL
     OR to_regclass('public.private_messages') IS NULL
     OR to_regclass('public.project_chat_reads') IS NULL
     OR to_regclass('public.notifications') IS NULL
     OR to_regclass('public.project_chat_events') IS NULL THEN
    RAISE EXCEPTION 'Realtime consumer table set is incomplete';
  END IF;
END
$issue105_realtime_publication$;

ALTER PUBLICATION supabase_realtime SET TABLE
  public.private_conversations,
  public.private_conversation_participants,
  public.private_messages,
  public.project_chat_reads,
  public.notifications,
  public.project_chat_events;
ALTER PUBLICATION supabase_realtime SET (publish = 'insert, update');
NOTIFY pgrst, 'reload schema';
