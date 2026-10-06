-- Local-only prototype for issue #105. Do not apply to staging or production.
-- Run from the local Supabase Postgres container as postgres.

CREATE SCHEMA issue105_phase0;
REVOKE ALL ON SCHEMA issue105_phase0 FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE issue105_phase0.auth_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prior_banned_until timestamptz,
  applied_banned_until timestamptz,
  auth_sync_pending boolean NOT NULL DEFAULT false
);

CREATE TABLE issue105_phase0.profile_reference_fixture (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT
);

CREATE FUNCTION issue105_phase0.current_session_eligible()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, issue105_phase0
AS $$
DECLARE
  v_uid uuid;
  v_session_id uuid;
BEGIN
  BEGIN
    v_uid := auth.uid();
    v_session_id := nullif(auth.jwt()->>'session_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  IF v_uid IS NULL OR v_session_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    JOIN auth.sessions s ON s.user_id = u.id
    WHERE p.id = v_uid
      AND p.is_active IS TRUE
      AND (u.banned_until IS NULL OR u.banned_until <= statement_timestamp())
      AND s.id = v_session_id
      AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
  );
END;
$$;

CREATE FUNCTION issue105_phase0.transition_profile(
  p_target_id uuid,
  p_actor_id uuid,
  p_active boolean,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, issue105_phase0
AS $$
DECLARE
  v_id uuid;
  v_prior timestamptz;
  v_applied timestamptz;
  v_current_ban timestamptz;
  v_next_ban timestamptz;
  v_sync boolean := false;
  v_pending boolean := false;
  v_changed boolean := false;
  v_target_name text;
  v_target_role text;
  v_old_active boolean;
BEGIN
  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SELF_ACCOUNT_ACTION';
  END IF;
  IF p_active IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(ARRAY[p_actor_id, p_target_id]) AS ids(x) ORDER BY x
  LOOP
    PERFORM 1 FROM public.profiles WHERE id = v_id FOR UPDATE;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_actor_id AND role = 'admin' AND is_active IS TRUE
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED'; END IF;
  SELECT full_name, role, is_active INTO v_target_name, v_target_role, v_old_active
  FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
  IF p_active IS FALSE AND v_target_role = 'admin' AND v_old_active IS TRUE
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active IS TRUE) <= 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ACTIVE_ADMIN'; END IF;
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(ARRAY[p_actor_id, p_target_id]) AS ids(x) ORDER BY x
  LOOP
    PERFORM 1 FROM auth.users WHERE id = v_id FOR UPDATE;
  END LOOP;

  IF p_active IS TRUE AND v_old_active IS TRUE THEN
    RETURN jsonb_build_object('active', true, 'authSynced', true, 'authSyncPending', false, 'noOp', true);
  END IF;
  v_changed := v_old_active IS DISTINCT FROM p_active;

  IF p_active IS FALSE THEN
    INSERT INTO issue105_phase0.auth_state(user_id, prior_banned_until, auth_sync_pending)
    SELECT p_target_id, banned_until, (v_old_active IS FALSE) FROM auth.users WHERE id = p_target_id
    ON CONFLICT (user_id) DO NOTHING;
    SELECT prior_banned_until, applied_banned_until, auth_sync_pending
      INTO v_prior, v_applied, v_pending
    FROM issue105_phase0.auth_state WHERE user_id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
    SELECT banned_until INTO v_current_ban FROM auth.users WHERE id = p_target_id;
    IF (v_applied IS NOT NULL AND v_current_ban IS DISTINCT FROM v_applied)
       OR (v_pending AND v_current_ban IS DISTINCT FROM v_prior) THEN
      v_prior := v_current_ban;
      UPDATE issue105_phase0.auth_state SET prior_banned_until = v_prior WHERE user_id = p_target_id;
    END IF;
    IF v_changed THEN
      UPDATE public.profiles SET is_active = false, updated_at = clock_timestamp() WHERE id = p_target_id;
    ELSIF NOT v_pending THEN
      RETURN jsonb_build_object('active', false, 'authSynced', true, 'authSyncPending', false, 'noOp', true);
    END IF;
    v_next_ban := clock_timestamp() + interval '10 years';
    IF v_prior IS NOT NULL AND v_prior > v_next_ban THEN v_next_ban := v_prior; END IF;
    BEGIN
      UPDATE auth.users SET banned_until = v_next_ban WHERE id = p_target_id;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
      DELETE FROM auth.sessions WHERE user_id = p_target_id;
      UPDATE issue105_phase0.auth_state
      SET applied_banned_until = v_next_ban, auth_sync_pending = false
      WHERE user_id = p_target_id;
      v_sync := true;
    EXCEPTION
      WHEN query_canceled THEN
        UPDATE issue105_phase0.auth_state SET auth_sync_pending = true WHERE user_id = p_target_id;
      WHEN OTHERS THEN
        UPDATE issue105_phase0.auth_state SET auth_sync_pending = true WHERE user_id = p_target_id;
    END;
  ELSE
    INSERT INTO issue105_phase0.auth_state(user_id, prior_banned_until, auth_sync_pending)
    SELECT p_target_id, banned_until, (v_old_active IS FALSE) FROM auth.users WHERE id = p_target_id
    ON CONFLICT (user_id) DO NOTHING;
    SELECT prior_banned_until, applied_banned_until
      INTO v_prior, v_applied
    FROM issue105_phase0.auth_state WHERE user_id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
    BEGIN
      DELETE FROM auth.sessions WHERE user_id = p_target_id;
      UPDATE auth.users
      SET banned_until = CASE WHEN banned_until = v_applied AND v_applied IS NOT NULL THEN v_prior ELSE banned_until END
      WHERE id = p_target_id;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
      DELETE FROM issue105_phase0.auth_state WHERE user_id = p_target_id;
      v_sync := true;
    EXCEPTION
      WHEN query_canceled THEN
        UPDATE issue105_phase0.auth_state SET auth_sync_pending = true WHERE user_id = p_target_id;
      WHEN OTHERS THEN
        UPDATE issue105_phase0.auth_state SET auth_sync_pending = true WHERE user_id = p_target_id;
    END;
    IF v_sync THEN
      UPDATE public.profiles SET is_active = true, updated_at = clock_timestamp() WHERE id = p_target_id;
    ELSE
      v_changed := false;
    END IF;
  END IF;

  IF v_changed THEN
    INSERT INTO public.audit_logs(user_id, action_type, entity_type, entity_id, entity_name, old_values, new_values, description)
    VALUES (
      p_actor_id, 'update', 'user', p_target_id, v_target_name,
      jsonb_build_object('is_active', v_old_active),
      jsonb_build_object(
        'operation', CASE WHEN p_active THEN 'reactivate' ELSE 'deactivate' END,
        'is_active', CASE WHEN p_active AND v_sync THEN true ELSE false END,
        'auth_sync_pending', NOT v_sync
      ),
      format('[issue105_phase0 run=%s] account %s', p_run_id, CASE WHEN p_active THEN 'reactivation' ELSE 'deactivation' END)
    );
  END IF;
  RETURN jsonb_build_object(
    'active', CASE WHEN p_active AND v_sync THEN true ELSE false END,
    'authSynced', v_sync,
    'authSyncPending', NOT v_sync,
    'changed', v_changed
  );
END;
$$;

CREATE FUNCTION issue105_phase0.hard_delete_user(
  p_target_id uuid,
  p_actor_id uuid,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, storage, issue105_phase0
AS $$
DECLARE
  v_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_ref record;
  v_count bigint;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SELF_ACCOUNT_ACTION';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(ARRAY[p_actor_id, p_target_id]) AS ids(x) ORDER BY x
  LOOP
    PERFORM 1 FROM public.profiles WHERE id = v_id FOR UPDATE;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_actor_id AND role = 'admin' AND is_active IS TRUE
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
  IF v_profile.role = 'admin' AND v_profile.is_active IS TRUE
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active IS TRUE) <= 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LAST_ACTIVE_ADMIN'; END IF;
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(ARRAY[p_actor_id, p_target_id]) AS ids(x) ORDER BY x
  LOOP
    PERFORM 1 FROM auth.users WHERE id = v_id FOR UPDATE;
  END LOOP;

  FOR v_ref IN
    SELECT c.conrelid, a.attname
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f' AND c.confrelid = 'public.profiles'::regclass
      AND c.conrelid <> 'public.audit_logs'::regclass
    ORDER BY c.conrelid::regclass::text, a.attname
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_ref.conrelid::regclass, v_ref.attname)
      INTO v_count USING p_target_id;
    IF v_count > 0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('kind', v_ref.conrelid::regclass::text || '.' || v_ref.attname, 'count', v_count));
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.audit_logs WHERE user_id = p_target_id;
  IF v_count > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('kind', 'public.audit_logs.user_id', 'count', v_count)); END IF;
  SELECT count(*) INTO v_count FROM storage.objects
  WHERE owner = p_target_id OR owner_id = p_target_id::text;
  IF v_count > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('kind', 'storage.objects.owner/owner_id', 'count', v_count)); END IF;
  IF jsonb_array_length(v_blockers) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_HAS_RELATED_DATA', DETAIL = jsonb_build_object('blockers', v_blockers)::text;
  END IF;

  DELETE FROM auth.users WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND'; END IF;
  INSERT INTO public.audit_logs(user_id, action_type, entity_type, entity_id, entity_name, old_values, description)
  VALUES (
    p_actor_id, 'delete', 'user', p_target_id, v_profile.full_name,
    jsonb_build_object('id', v_profile.id, 'email', v_profile.email, 'full_name', v_profile.full_name, 'role', v_profile.role),
    format('[issue105_phase0 run=%s] account hard delete', p_run_id)
  );
  RETURN jsonb_build_object('deleted', true, 'userId', p_target_id);
END;
$$;

CREATE FUNCTION issue105_phase0.guard_storage_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, issue105_phase0
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.owner IS NULL AND NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.owner IS NOT NULL AND NEW.owner_id IS NOT NULL AND NEW.owner <> NEW.owner_id::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STORAGE_OWNER_MISMATCH';
  END IF;
  v_owner := coalesce(NEW.owner, NEW.owner_id::uuid);
  PERFORM 1 FROM public.profiles WHERE id = v_owner FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STORAGE_OWNER_PROFILE_REQUIRED'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue105_phase0_storage_owner_guard
BEFORE INSERT OR UPDATE OF owner, owner_id ON storage.objects
FOR EACH ROW EXECUTE FUNCTION issue105_phase0.guard_storage_owner();

REVOKE ALL ON ALL TABLES IN SCHEMA issue105_phase0 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA issue105_phase0 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA issue105_phase0 FROM PUBLIC, anon, authenticated, service_role;
