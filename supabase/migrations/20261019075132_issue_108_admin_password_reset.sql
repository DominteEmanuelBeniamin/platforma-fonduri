-- Issue #108: private receipts and atomic administrator password reset.
CREATE TABLE account_recovery.admin_password_resets (
  attempt_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text,
  nume_firma text,
  is_current boolean NOT NULL DEFAULT true,
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed', 'unknown', 'skipped')),
  delivery_reason text
    CHECK (delivery_reason IS NULL OR delivery_reason IN (
      'target_ineligible', 'recipient_changed', 'superseded', 'actor_ineligible',
      'already_claimed', 'configuration', 'provider_rejected', 'provider_unconfirmed',
      'delivery_not_started'
    )),
  provider_id text CHECK (provider_id IS NULL OR length(provider_id) <= 256),
  delivery_audited boolean NOT NULL DEFAULT false,
  fallback_claimed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivery_started_at timestamptz,
  delivery_finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (delivery_finished_at IS NULL OR delivery_status <> 'pending'),
  CHECK (delivery_status NOT IN ('sent', 'failed', 'skipped') OR delivery_finished_at IS NOT NULL),
  CHECK (delivery_audited IS FALSE OR delivery_finished_at IS NOT NULL),
  CHECK (fallback_claimed IS FALSE OR delivery_status = 'failed')
);

CREATE INDEX admin_password_resets_user_idx
  ON account_recovery.admin_password_resets(user_id);

ALTER TABLE account_recovery.admin_password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.admin_password_resets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON account_recovery.admin_password_resets
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON TABLE account_recovery.admin_password_resets IS
  'Private non-secret receipts for administrator password reset attempts; retained until target deletion.';

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_supersede(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  UPDATE account_recovery.admin_password_resets
  SET is_current = false, updated_at = clock_timestamp()
  WHERE user_id = p_user_id AND is_current IS TRUE
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_auth_change_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email
     OR NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
     OR NEW.banned_until IS DISTINCT FROM OLD.banned_until
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM account_recovery.admin_reset_supersede(NEW.id);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_profile_change_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    PERFORM account_recovery.admin_reset_supersede(NEW.id);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER issue108_admin_auth_lock
BEFORE UPDATE OF banned_until, deleted_at ON auth.users
FOR EACH STATEMENT EXECUTE FUNCTION public.issue105_acquire_account_lock();

CREATE TRIGGER issue108_admin_auth_change
AFTER UPDATE OF email, encrypted_password, banned_until, deleted_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION account_recovery.admin_reset_auth_change_guard();

CREATE TRIGGER issue108_admin_profile_change
AFTER UPDATE OF email, is_active ON public.profiles
FOR EACH ROW EXECUTE FUNCTION account_recovery.admin_reset_profile_change_guard();

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_actor_session_active(
  p_actor_id uuid, p_session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL OR p_session_id IS NULL THEN RETURN false; END IF;
  PERFORM 1
  FROM auth.sessions AS s
  WHERE s.id = p_session_id
    AND s.user_id = p_actor_id
    AND (s.not_after IS NULL OR s.not_after > v_now)
  FOR KEY SHARE;
  RETURN FOUND;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_target_problem(
  p_target_id uuid, p_expected_email text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles AS p
  WHERE p.id = p_target_id;
  IF NOT FOUND OR v_profile.is_active IS DISTINCT FROM true
     OR coalesce(v_profile.auth_sync_pending, false) THEN
    RETURN 'target_ineligible';
  END IF;

  IF v_profile.email IS DISTINCT FROM p_expected_email THEN
    RETURN 'recipient_changed';
  END IF;

  SELECT u.* INTO v_auth
  FROM auth.users AS u
  WHERE u.id = p_target_id;
  IF NOT FOUND OR lower(btrim(v_profile.email)) IS DISTINCT FROM lower(btrim(v_auth.email)) THEN
    RETURN 'recipient_changed';
  END IF;

  IF NOT account_recovery.recovery_auth_eligible(v_auth.id, lower(btrim(v_auth.email))) THEN
    RETURN 'target_ineligible';
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_delivery_audit_impl(p_attempt_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_receipt account_recovery.admin_password_resets%ROWTYPE;
BEGIN
  SELECT r.* INTO v_receipt
  FROM account_recovery.admin_password_resets AS r
  WHERE r.attempt_id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.delivery_finished_at IS NULL THEN
    RETURN false;
  END IF;
  IF v_receipt.delivery_audited IS TRUE THEN RETURN true; END IF;

  BEGIN
    INSERT INTO public.audit_logs(
      user_id, action_type, entity_type, entity_id, entity_name,
      new_values, description
    ) VALUES (
      NULL, 'notify', 'user', v_receipt.user_id, v_receipt.email,
      jsonb_build_object(
        'source', 'admin_reset_delivery',
        'attempt_id', v_receipt.attempt_id,
        'actor_id', v_receipt.actor_id,
        'delivery_status', v_receipt.delivery_status,
        'reason', v_receipt.delivery_reason,
        'provider_id', v_receipt.provider_id
      ),
      'Predarea emailului pentru resetarea administrativă a parolei'
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  UPDATE account_recovery.admin_password_resets
  SET delivery_audited = true, updated_at = clock_timestamp()
  WHERE attempt_id = p_attempt_id;
  RETURN true;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_password_impl(
  p_actor_id uuid,
  p_actor_session_id uuid,
  p_target_id uuid,
  p_attempt_id uuid,
  p_expected_email text,
  p_password text,
  p_ip_address text,
  p_user_agent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
  v_session_valid boolean;
  v_receipt account_recovery.admin_password_resets%ROWTYPE;
  v_hash text;
  v_now timestamptz;
BEGIN
  IF p_actor_id IS NULL OR p_target_id IS NULL OR p_attempt_id IS NULL
     OR p_expected_email IS NULL OR p_password IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RESET_REQUEST';
  END IF;
  IF p_ip_address IS NOT NULL AND (length(p_ip_address) > 64 OR NOT pg_input_is_valid(p_ip_address, 'inet'))
     OR p_user_agent IS NOT NULL AND length(p_user_agent) > 512 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_RESET_METADATA';
  END IF;
  IF char_length(p_password) < 6 OR octet_length(p_password) > 72 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RESET_PASSWORD';
  END IF;

  -- bcrypt does not depend on locked state; hashing before the exclusive lock keeps
  -- every shared (105, 1) writer from waiting on it.
  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
  IF v_hash IS NULL OR v_hash !~ '^\$2a\$10\$[./A-Za-z0-9]{53}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESET_BCRYPT_PREFLIGHT_FAILED';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  PERFORM p.id
  FROM public.profiles AS p
  WHERE p.id IN (p_actor_id, p_target_id)
  ORDER BY p.id
  FOR UPDATE;

  SELECT p.* INTO v_actor FROM public.profiles AS p WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_actor.role IS DISTINCT FROM 'admin' OR v_actor.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_ADMIN_REQUIRED';
  END IF;

  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SELF_ACCOUNT_ACTION';
  END IF;

  SELECT p.* INTO v_target FROM public.profiles AS p WHERE p.id = p_target_id;
  SELECT u.* INTO v_auth FROM auth.users AS u WHERE u.id = p_target_id FOR UPDATE;
  v_session_valid := account_recovery.admin_reset_actor_session_active(p_actor_id, p_actor_session_id);
  IF NOT v_session_valid THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ADMIN_SESSION_INVALID';
  END IF;

  SELECT r.* INTO v_receipt
  FROM account_recovery.admin_password_resets AS r
  WHERE r.attempt_id = p_attempt_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.actor_id IS DISTINCT FROM p_actor_id
       OR v_receipt.user_id IS DISTINCT FROM p_target_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ATTEMPT_CONFLICT';
    END IF;
    RETURN jsonb_build_object(
      'status', 'completed',
      'replayed', true,
      'attempt_id', v_receipt.attempt_id,
      'email', v_receipt.email,
      'full_name', v_receipt.full_name,
      'role', v_receipt.role,
      'nume_firma', v_receipt.nume_firma,
      'is_current', v_receipt.is_current,
      'delivery_status', v_receipt.delivery_status,
      'delivery_audited', v_receipt.delivery_audited
    );
  END IF;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;

  -- Two tabs (or two admins) confirming together carry different attempt ids; the lock
  -- above serializes them, and the later one must not reset the account while the first
  -- is still delivering. A finished reset (sent, failed, unknown) does not block a new one;
  -- the 60-second bound matches the abandoned-delivery reconciliation.
  PERFORM 1
  FROM account_recovery.admin_password_resets AS r
  WHERE r.user_id = p_target_id
    AND r.is_current IS TRUE
    AND r.delivery_status = 'pending'
    AND r.created_at > clock_timestamp() - interval '60 seconds';
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECENT_RESET_EXISTS';
  END IF;

  IF v_target.is_active IS DISTINCT FROM true OR coalesce(v_target.auth_sync_pending, false)
     OR v_auth.id IS NULL OR lower(btrim(v_target.email)) IS DISTINCT FROM lower(btrim(v_auth.email))
     OR NOT account_recovery.recovery_auth_eligible(v_auth.id, lower(btrim(v_auth.email))) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TARGET_ACCOUNT_INELIGIBLE';
  END IF;
  IF btrim(v_target.email) IS DISTINCT FROM btrim(p_expected_email) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EXPECTED_EMAIL_MISMATCH';
  END IF;

  v_now := clock_timestamp();

  UPDATE auth.users
  SET encrypted_password = v_hash,
      updated_at = v_now,
      confirmation_token = '', confirmation_sent_at = NULL,
      recovery_token = '', recovery_sent_at = NULL,
      email_change_token_new = '', email_change_token_current = '', email_change_sent_at = NULL,
      phone_change_token = '', phone_change_sent_at = NULL,
      reauthentication_token = '', reauthentication_sent_at = NULL
  WHERE id = p_target_id;

  DELETE FROM auth.one_time_tokens WHERE user_id = p_target_id;
  DELETE FROM auth.flow_state WHERE user_id = p_target_id OR linking_target_id = p_target_id;
  DELETE FROM auth.sessions WHERE user_id = p_target_id;
  UPDATE public.profiles
  SET must_change_password = true,
      password_reset_requested_at = NULL
  WHERE id = p_target_id;

  PERFORM account_recovery.invalidate_account_recovery_state(p_target_id, true);

  INSERT INTO account_recovery.admin_password_resets(
    attempt_id, actor_id, user_id, email, full_name, role, nume_firma,
    is_current, delivery_status, created_at, updated_at
  ) VALUES (
    p_attempt_id, p_actor_id, p_target_id, v_target.email, v_target.full_name, v_target.role, v_target.nume_firma,
    true, 'pending', v_now, v_now
  )
  RETURNING * INTO v_receipt;

  INSERT INTO public.audit_logs(
    user_id, action_type, entity_type, entity_id, entity_name,
    new_values, description, ip_address, user_agent
  ) VALUES (
    p_actor_id, 'password_reset_completed', 'user', p_target_id, v_target.email,
    jsonb_build_object(
      'source', 'admin_reset',
      'attempt_id', p_attempt_id,
      'must_change_password', true
    ),
    format(
      'Administratorul %s a resetat parola contului %s.',
      coalesce(v_actor.email, v_actor.full_name, p_actor_id::text),
      coalesce(v_target.email, v_target.full_name, p_target_id::text)
    ),
    p_ip_address, p_user_agent
  );

  RETURN jsonb_build_object(
    'status', 'completed',
    'replayed', false,
    'attempt_id', v_receipt.attempt_id,
    'email', v_receipt.email,
    'full_name', v_receipt.full_name,
    'role', v_receipt.role,
    'nume_firma', v_receipt.nume_firma,
    'is_current', v_receipt.is_current,
    'delivery_status', v_receipt.delivery_status,
    'delivery_audited', v_receipt.delivery_audited
  );
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_password_prepare_delivery_impl(
  p_actor_id uuid, p_actor_session_id uuid, p_target_id uuid, p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_receipt account_recovery.admin_password_resets%ROWTYPE;
  v_skip_reason text;
  v_now timestamptz;
BEGIN
  IF p_actor_id IS NULL OR p_target_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESET_ATTEMPT_NOT_FOUND';
  END IF;
  PERFORM pg_advisory_xact_lock(105, 1);

  PERFORM p.id
  FROM public.profiles AS p
  WHERE p.id IN (p_actor_id, p_target_id)
  ORDER BY p.id
  FOR UPDATE;
  SELECT p.* INTO v_actor FROM public.profiles AS p WHERE p.id = p_actor_id;
  PERFORM 1 FROM auth.users AS u WHERE u.id = p_target_id FOR UPDATE;

  SELECT r.* INTO v_receipt
  FROM account_recovery.admin_password_resets AS r
  WHERE r.attempt_id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.actor_id IS DISTINCT FROM p_actor_id
     OR v_receipt.user_id IS DISTINCT FROM p_target_id THEN
    IF EXISTS (
      SELECT 1 FROM account_recovery.admin_password_resets AS r WHERE r.attempt_id = p_attempt_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ATTEMPT_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESET_ATTEMPT_NOT_FOUND';
  END IF;

  IF v_actor.id IS NULL OR v_actor.role IS DISTINCT FROM 'admin' OR v_actor.is_active IS DISTINCT FROM true
     OR NOT account_recovery.admin_reset_actor_session_active(p_actor_id, p_actor_session_id) THEN
    v_skip_reason := 'actor_ineligible';
  ELSIF v_receipt.is_current IS NOT TRUE THEN
    v_skip_reason := 'superseded';
  ELSE
    v_skip_reason := account_recovery.admin_reset_target_problem(p_target_id, v_receipt.email);
  END IF;

  IF v_skip_reason IS NOT NULL THEN
    IF v_receipt.delivery_status = 'pending' THEN
      v_now := clock_timestamp();
      UPDATE account_recovery.admin_password_resets
      SET delivery_status = 'skipped', delivery_reason = v_skip_reason,
          delivery_finished_at = v_now, updated_at = v_now
      WHERE attempt_id = p_attempt_id
      RETURNING * INTO v_receipt;
      PERFORM account_recovery.admin_reset_delivery_audit_impl(p_attempt_id);
      SELECT r.* INTO v_receipt FROM account_recovery.admin_password_resets AS r
      WHERE r.attempt_id = p_attempt_id;
    END IF;
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', v_skip_reason,
      'attempt_id', v_receipt.attempt_id,
      'delivery_status', v_receipt.delivery_status,
      'delivery_audited', v_receipt.delivery_audited,
      'is_current', v_receipt.is_current
    );
  END IF;

  IF v_receipt.delivery_status <> 'pending' THEN
    IF v_receipt.delivery_finished_at IS NOT NULL AND v_receipt.delivery_audited IS FALSE THEN
      PERFORM account_recovery.admin_reset_delivery_audit_impl(p_attempt_id);
      SELECT r.* INTO v_receipt FROM account_recovery.admin_password_resets AS r
      WHERE r.attempt_id = p_attempt_id;
    END IF;
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'already_claimed',
      'attempt_id', v_receipt.attempt_id,
      'delivery_status', v_receipt.delivery_status,
      'delivery_audited', v_receipt.delivery_audited,
      'is_current', v_receipt.is_current
    );
  END IF;

  v_now := clock_timestamp();
  UPDATE account_recovery.admin_password_resets
  SET delivery_status = 'unknown', delivery_started_at = v_now,
      delivery_reason = NULL, provider_id = NULL, updated_at = v_now
  WHERE attempt_id = p_attempt_id
  RETURNING * INTO v_receipt;

  RETURN jsonb_build_object(
    'status', 'send',
    'attempt_id', v_receipt.attempt_id,
    'email', v_receipt.email,
    'full_name', v_receipt.full_name,
    'delivery_status', v_receipt.delivery_status,
    'delivery_audited', v_receipt.delivery_audited,
    'is_current', v_receipt.is_current
  );
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_password_finish_delivery_impl(
  p_target_id uuid, p_attempt_id uuid, p_outcome text, p_reason text, p_provider_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_receipt account_recovery.admin_password_resets%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_target_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESET_ATTEMPT_NOT_FOUND';
  END IF;
  IF p_outcome IS NOT NULL AND p_outcome NOT IN ('sent', 'failed', 'unknown', 'skipped') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DELIVERY_OUTCOME_INVALID';
  END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN (
    'target_ineligible', 'recipient_changed', 'superseded', 'actor_ineligible',
    'already_claimed', 'configuration', 'provider_rejected', 'provider_unconfirmed',
    'delivery_not_started'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DELIVERY_REASON_INVALID';
  END IF;
  IF p_provider_id IS NOT NULL AND length(p_provider_id) > 256 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DELIVERY_PROVIDER_ID_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT r.* INTO v_receipt
  FROM account_recovery.admin_password_resets AS r
  WHERE r.attempt_id = p_attempt_id AND r.user_id = p_target_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM account_recovery.admin_password_resets AS r WHERE r.attempt_id = p_attempt_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ATTEMPT_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESET_ATTEMPT_NOT_FOUND';
  END IF;

  IF p_outcome IS NOT NULL
     AND v_receipt.delivery_status = 'unknown'
     AND v_receipt.delivery_finished_at IS NULL THEN
    v_now := clock_timestamp();
    UPDATE account_recovery.admin_password_resets
    SET delivery_status = p_outcome,
        delivery_reason = p_reason,
        provider_id = p_provider_id,
        delivery_finished_at = v_now,
        updated_at = v_now
    WHERE attempt_id = p_attempt_id
    RETURNING * INTO v_receipt;
  END IF;

  IF v_receipt.delivery_finished_at IS NOT NULL AND v_receipt.delivery_audited IS FALSE THEN
    PERFORM account_recovery.admin_reset_delivery_audit_impl(p_attempt_id);
    SELECT r.* INTO v_receipt FROM account_recovery.admin_password_resets AS r
    WHERE r.attempt_id = p_attempt_id;
  END IF;

  RETURN jsonb_build_object(
    'delivery_status', v_receipt.delivery_status,
    'delivery_audited', v_receipt.delivery_audited,
    'is_current', v_receipt.is_current
  );
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.admin_reset_password_claim_fallback_impl(
  p_actor_id uuid, p_actor_session_id uuid, p_target_id uuid, p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_receipt account_recovery.admin_password_resets%ROWTYPE;
  v_reason text;
BEGIN
  IF p_actor_id IS NULL OR p_target_id IS NULL OR p_attempt_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'superseded');
  END IF;
  PERFORM pg_advisory_xact_lock(105, 1);

  PERFORM p.id
  FROM public.profiles AS p
  WHERE p.id IN (p_actor_id, p_target_id)
  ORDER BY p.id
  FOR UPDATE;
  SELECT p.* INTO v_actor FROM public.profiles AS p WHERE p.id = p_actor_id;
  PERFORM 1 FROM auth.users AS u WHERE u.id = p_target_id FOR UPDATE;

  SELECT r.* INTO v_receipt
  FROM account_recovery.admin_password_resets AS r
  WHERE r.attempt_id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.actor_id IS DISTINCT FROM p_actor_id
     OR v_receipt.user_id IS DISTINCT FROM p_target_id THEN
    IF EXISTS (
      SELECT 1 FROM account_recovery.admin_password_resets AS r WHERE r.attempt_id = p_attempt_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ATTEMPT_CONFLICT';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESET_ATTEMPT_NOT_FOUND';
  END IF;

  IF v_actor.id IS NULL OR v_actor.role IS DISTINCT FROM 'admin' OR v_actor.is_active IS DISTINCT FROM true
     OR NOT account_recovery.admin_reset_actor_session_active(p_actor_id, p_actor_session_id) THEN
    v_reason := 'actor_ineligible';
  ELSIF v_receipt.is_current IS NOT TRUE THEN
    v_reason := 'superseded';
  ELSE
    v_reason := account_recovery.admin_reset_target_problem(p_target_id, v_receipt.email);
  END IF;

  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', v_reason);
  END IF;
  IF v_receipt.delivery_status <> 'failed' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_failed');
  END IF;
  IF v_receipt.fallback_claimed IS TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'already_claimed');
  END IF;

  UPDATE account_recovery.admin_password_resets
  SET fallback_claimed = true, updated_at = clock_timestamp()
  WHERE attempt_id = p_attempt_id
  RETURNING * INTO v_receipt;
  RETURN jsonb_build_object('allowed', true, 'attempt_id', v_receipt.attempt_id);
END
$fn$;

REVOKE ALL ON FUNCTION account_recovery.admin_reset_supersede(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_auth_change_guard()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_profile_change_guard()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_actor_session_active(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_target_problem(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_delivery_audit_impl(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_password_impl(uuid, uuid, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_password_prepare_delivery_impl(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_password_finish_delivery_impl(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.admin_reset_password_claim_fallback_impl(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;



CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_actor_id uuid, p_actor_session_id uuid, p_target_id uuid, p_attempt_id uuid,
  p_expected_email text, p_password text, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.admin_reset_password_impl(
    p_actor_id, p_actor_session_id, p_target_id, p_attempt_id,
    p_expected_email, p_password, p_ip_address, p_user_agent
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_reset_password_prepare_delivery(
  p_actor_id uuid, p_actor_session_id uuid, p_target_id uuid, p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.admin_reset_password_prepare_delivery_impl(
    p_actor_id, p_actor_session_id, p_target_id, p_attempt_id
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_reset_password_finish_delivery(
  p_target_id uuid, p_attempt_id uuid, p_outcome text DEFAULT NULL,
  p_reason text DEFAULT NULL, p_provider_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.admin_reset_password_finish_delivery_impl(
    p_target_id, p_attempt_id, p_outcome, p_reason, p_provider_id
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_reset_password_claim_fallback(
  p_actor_id uuid, p_actor_session_id uuid, p_target_id uuid, p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.admin_reset_password_claim_fallback_impl(
    p_actor_id, p_actor_session_id, p_target_id, p_attempt_id
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_reset_password(uuid, uuid, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_reset_password_prepare_delivery(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_reset_password_finish_delivery(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_reset_password_claim_fallback(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid, uuid, uuid, uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_password_prepare_delivery(uuid, uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_password_finish_delivery(uuid, uuid, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_password_claim_fallback(uuid, uuid, uuid, uuid)
  TO service_role;
