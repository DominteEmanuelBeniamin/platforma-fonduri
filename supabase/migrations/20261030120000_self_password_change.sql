-- „Contul meu”: oricine își schimbă singur parola, cu parola actuală.
-- Cât recuperarea (#107) e activă, GoTrue nu mai poate scrie parole
-- (PASSWORD_CHANGE_REQUIRES_ATOMIC_PATH), deci schimbarea trece, ca resetarea
-- de către admin (#108), printr-o funcție care verifică, scrie hash-ul,
-- închide celelalte sesiuni și scrie auditul în aceeași tranzacție.

-- Încercările greșite ale parolei actuale: după 5 în 15 minute, contul nu mai
-- primește încercări până se golește fereastra. Altfel o sesiune furată ar
-- putea ghici parola contului prin această rută.
CREATE TABLE account_recovery.password_change_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  failed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX password_change_failures_user_idx
  ON account_recovery.password_change_failures(user_id, failed_at);

ALTER TABLE account_recovery.password_change_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.password_change_failures FORCE ROW LEVEL SECURITY;
REVOKE ALL ON account_recovery.password_change_failures
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON TABLE account_recovery.password_change_failures IS
  'Încercări greșite ale parolei actuale la schimbarea din „Contul meu”; limitează ghicirea parolei.';

CREATE OR REPLACE FUNCTION account_recovery.self_change_password_impl(
  p_user_id uuid,
  p_session_id uuid,
  p_current_password text,
  p_new_password text,
  p_ip_address text,
  p_user_agent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
  v_hash text;
  v_now timestamptz;
  v_failures integer;
  v_revoked integer;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_current_password IS NULL OR p_new_password IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PASSWORD_CHANGE_REQUEST';
  END IF;
  IF p_ip_address IS NOT NULL AND (length(p_ip_address) > 64 OR NOT pg_input_is_valid(p_ip_address, 'inet'))
     OR p_user_agent IS NOT NULL AND length(p_user_agent) > 512 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PASSWORD_CHANGE_METADATA';
  END IF;
  IF octet_length(p_current_password) > 72 THEN
    RETURN jsonb_build_object('status', 'wrong_password');
  END IF;
  IF char_length(p_new_password) < 6 OR octet_length(p_new_password) > 72 THEN
    RETURN jsonb_build_object('status', 'password_invalid');
  END IF;

  -- Ca la #108: bcrypt nu depinde de rândurile blocate, deci hash-ul se face
  -- înaintea blocării exclusive, ca ceilalți scriitori să nu-l aștepte.
  v_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf', 10));
  IF v_hash IS NULL OR v_hash !~ '^\$2a\$10\$[./A-Za-z0-9]{53}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PASSWORD_CHANGE_BCRYPT_PREFLIGHT_FAILED';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT p.* INTO v_profile FROM public.profiles AS p WHERE p.id = p_user_id FOR UPDATE;
  SELECT u.* INTO v_auth FROM auth.users AS u WHERE u.id = p_user_id FOR UPDATE;
  v_now := clock_timestamp();

  IF NOT account_recovery.admin_reset_actor_session_active(p_user_id, p_session_id) THEN
    RETURN jsonb_build_object('status', 'session_invalid');
  END IF;
  IF v_profile.id IS NULL OR v_auth.id IS NULL OR v_profile.is_active IS DISTINCT FROM true
     OR coalesce(v_profile.auth_sync_pending, false)
     OR lower(btrim(v_profile.email)) IS DISTINCT FROM lower(btrim(v_auth.email))
     OR NOT account_recovery.recovery_auth_eligible(v_auth.id, lower(btrim(v_auth.email))) THEN
    RETURN jsonb_build_object('status', 'ineligible');
  END IF;

  DELETE FROM account_recovery.password_change_failures
  WHERE failed_at < v_now - interval '1 day';
  SELECT count(*) INTO v_failures
  FROM account_recovery.password_change_failures AS f
  WHERE f.user_id = p_user_id AND f.failed_at > v_now - interval '15 minutes';
  IF v_failures >= 5 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  BEGIN
    IF extensions.crypt(p_current_password, v_auth.encrypted_password) IS DISTINCT FROM v_auth.encrypted_password THEN
      INSERT INTO account_recovery.password_change_failures(user_id, failed_at) VALUES (p_user_id, v_now);
      RETURN jsonb_build_object('status', 'wrong_password', 'attempts_left', greatest(0, 4 - v_failures));
    END IF;
    IF extensions.crypt(p_new_password, v_auth.encrypted_password) = v_auth.encrypted_password THEN
      RETURN jsonb_build_object('status', 'same_password');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'ineligible');
  END;

  UPDATE auth.users
  SET encrypted_password = v_hash,
      updated_at = v_now,
      confirmation_token = '', confirmation_sent_at = NULL,
      recovery_token = '', recovery_sent_at = NULL,
      email_change_token_new = '', email_change_token_current = '', email_change_sent_at = NULL,
      phone_change_token = '', phone_change_sent_at = NULL,
      reauthentication_token = '', reauthentication_sent_at = NULL
  WHERE id = p_user_id;

  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;
  DELETE FROM auth.flow_state WHERE user_id = p_user_id OR linking_target_id = p_user_id;
  -- Sesiunea din care s-a schimbat parola rămâne; celelalte dispozitive ies.
  DELETE FROM auth.sessions WHERE user_id = p_user_id AND id <> p_session_id;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;
  UPDATE public.profiles SET must_change_password = false WHERE id = p_user_id;
  PERFORM account_recovery.invalidate_account_recovery_state(p_user_id, true);
  DELETE FROM account_recovery.password_change_failures WHERE user_id = p_user_id;

  INSERT INTO public.audit_logs(
    user_id, action_type, entity_type, entity_id, entity_name,
    new_values, description, ip_address, user_agent
  ) VALUES (
    p_user_id, 'password_changed', 'user', p_user_id, v_auth.email,
    jsonb_build_object(
      'source', 'self_service',
      'was_temporary', coalesce(v_profile.must_change_password, false),
      'other_sessions_revoked', v_revoked
    ),
    'Parola schimbată din „Contul meu”',
    p_ip_address, p_user_agent
  );

  RETURN jsonb_build_object(
    'status', 'completed',
    'email', v_auth.email,
    'full_name', v_profile.full_name,
    'other_sessions_revoked', v_revoked
  );
END
$fn$;

REVOKE ALL ON FUNCTION account_recovery.self_change_password_impl(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.self_change_password(
  p_user_id uuid, p_session_id uuid, p_current_password text, p_new_password text,
  p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.self_change_password_impl(
    p_user_id, p_session_id, p_current_password, p_new_password, p_ip_address, p_user_agent
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.self_change_password(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.self_change_password(uuid, uuid, text, text, text, text)
  TO service_role;
