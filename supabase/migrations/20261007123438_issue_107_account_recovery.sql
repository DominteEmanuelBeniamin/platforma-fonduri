-- Issue #107: disabled installation; activate only after the read-only Auth preflight.
-- Migration generated with `supabase db pull --local --schema account_recovery,public,auth
-- --diff-engine pg-delta --strict-coverage`, then reviewed for data initialization and ACLs.
CREATE SCHEMA IF NOT EXISTS account_recovery AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA account_recovery FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA account_recovery TO supabase_auth_admin;

CREATE TABLE IF NOT EXISTS account_recovery.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  auth_version text,
  activated_at timestamptz
);
INSERT INTO account_recovery.settings(singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS account_recovery.flows (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL UNIQUE,
  token_hash text,
  email text NOT NULL,
  state text NOT NULL CHECK (state IN ('issued', 'completed', 'invalidated')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_id uuid,
  completed_at timestamptz,
  CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS account_recovery.receipts (
  flow_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  attempt_id uuid NOT NULL,
  completed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (flow_id, token_hash, attempt_id)
);

CREATE TABLE IF NOT EXISTS account_recovery.deliveries (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('request', 'confirmation')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'retry', 'leased', 'sent', 'failed', 'skipped', 'expired')),
  payload_cipher text,
  frozen_payload_cipher text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient text,
  flow_id uuid,
  attempt_id uuid,
  request_ip text,
  request_user_agent text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  issued_at timestamptz,
  expires_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_id uuid,
  lease_expires_at timestamptz,
  provider_id text,
  CHECK (kind <> 'request' OR payload_cipher IS NOT NULL OR state IN ('sent', 'failed', 'skipped', 'expired')),
  CHECK (state <> 'leased' OR (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS account_recovery.rate_limits (
  scope text NOT NULL CHECK (scope IN ('ip', 'global')),
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL CHECK (hit_count > 0),
  PRIMARY KEY (scope, subject, window_start)
);

CREATE INDEX IF NOT EXISTS account_recovery_deliveries_due_idx
  ON account_recovery.deliveries(next_attempt_at, created_at)
  WHERE state IN ('queued', 'retry', 'leased');
CREATE INDEX IF NOT EXISTS account_recovery_deliveries_user_idx
  ON account_recovery.deliveries(user_id, state) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_recovery_receipts_user_idx ON account_recovery.receipts(user_id);
CREATE INDEX IF NOT EXISTS account_recovery_receipts_expiry_idx ON account_recovery.receipts(expires_at);
CREATE INDEX IF NOT EXISTS account_recovery_rate_limits_expiry_idx ON account_recovery.rate_limits(window_start);

ALTER TABLE account_recovery.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.settings FORCE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.flows FORCE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery.rate_limits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA account_recovery
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON account_recovery.settings TO supabase_auth_admin;
DROP POLICY IF EXISTS account_recovery_hook_settings_read ON account_recovery.settings;
CREATE POLICY account_recovery_hook_settings_read ON account_recovery.settings
  FOR SELECT TO supabase_auth_admin USING (singleton);

COMMENT ON SCHEMA account_recovery IS 'Private Issue #107 recovery state; not exposed through the Data API.';
COMMENT ON TABLE account_recovery.flows IS 'Only the current proof per account; raw recovery tokens are never stored.';
COMMENT ON TABLE account_recovery.receipts IS 'Immutable proof-bound completion outcomes retained for 24 hours.';
COMMENT ON TABLE account_recovery.deliveries IS 'Durable leased recovery and confirmation delivery queue; payloads are server-encrypted.';
COMMENT ON TABLE account_recovery.rate_limits IS 'Atomic IP and global volume windows for anonymous recovery requests.';

CREATE OR REPLACE FUNCTION account_recovery.recovery_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
  SELECT coalesce((SELECT s.enabled FROM account_recovery.settings AS s WHERE s.singleton), false)
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_auth_eligible(p_user_id uuid, p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = p_user_id AND lower(btrim(u.email)) = p_email
      AND u.email_confirmed_at IS NOT NULL
      AND u.encrypted_password ~ '^\$2a\$(0[5-9]|10)\$[./A-Za-z0-9]{53}$'
      AND coalesce((u.raw_app_meta_data -> 'providers') ? 'email', false)
      AND coalesce(u.is_anonymous, false) IS FALSE AND coalesce(u.is_sso_user, false) IS FALSE
      AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= clock_timestamp())
  )
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.invalidate_account_recovery_state(
  p_user_id uuid, p_clear_cooldown boolean DEFAULT true
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  UPDATE account_recovery.flows
  SET state = 'invalidated', token_hash = NULL, attempt_id = NULL
  WHERE user_id = p_user_id AND state = 'issued';
  IF p_clear_cooldown THEN
    UPDATE public.profiles SET password_reset_requested_at = NULL WHERE id = p_user_id;
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_preflight_impl()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_hash text;
  v_ok boolean;
  v_version text;
BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regclass('auth.sessions') IS NULL
     OR to_regclass('auth.one_time_tokens') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.audit_logs') IS NULL OR to_regclass('storage.objects') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin')
     OR to_regprocedure('extensions.crypt(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_salt(text,integer)') IS NULL
     OR to_regprocedure('public.issue105_acquire_account_lock()') IS NULL
     OR to_regprocedure('account_recovery.send_email_hook(jsonb)') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_PREFLIGHT_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (to_regclass('auth.users'), 'id', ARRAY['uuid']::text[]),
      (to_regclass('auth.users'), 'email', ARRAY['text','character varying']::text[]),
      (to_regclass('auth.users'), 'encrypted_password', ARRAY['text','character varying']::text[]),
      (to_regclass('auth.users'), 'email_confirmed_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.users'), 'raw_app_meta_data', ARRAY['jsonb']::text[]),
      (to_regclass('auth.users'), 'banned_until', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.users'), 'deleted_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.users'), 'is_anonymous', ARRAY['boolean']::text[]),
      (to_regclass('auth.users'), 'is_sso_user', ARRAY['boolean']::text[]),
      (to_regclass('auth.users'), 'updated_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.users'), 'recovery_token', ARRAY['text','character varying']::text[]),
      (to_regclass('auth.users'), 'recovery_sent_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.users'), 'confirmation_token', ARRAY['text','character varying']::text[]),
      (to_regclass('auth.users'), 'confirmation_sent_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.users'), 'email_change_token_new', ARRAY['text','character varying']::text[]),
      (to_regclass('auth.users'), 'email_change_token_current', ARRAY['text','character varying']::text[]),
      (to_regclass('auth.users'), 'email_change_sent_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.users'), 'phone_change_token', ARRAY['text','character varying']::text[]),
      (to_regclass('auth.users'), 'phone_change_sent_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.users'), 'reauthentication_token', ARRAY['text','character varying']::text[]),
      (to_regclass('auth.users'), 'reauthentication_sent_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('auth.sessions'), 'id', ARRAY['uuid']::text[]),
      (to_regclass('auth.sessions'), 'user_id', ARRAY['uuid']::text[]),
      (to_regclass('auth.one_time_tokens'), 'user_id', ARRAY['uuid']::text[]),
      (to_regclass('public.profiles'), 'id', ARRAY['uuid']::text[]),
      (to_regclass('public.profiles'), 'email', ARRAY['text','character varying']::text[]),
      (to_regclass('public.profiles'), 'is_active', ARRAY['boolean']::text[]),
      (to_regclass('public.profiles'), 'auth_sync_pending', ARRAY['boolean']::text[]),
      (to_regclass('public.profiles'), 'must_change_password', ARRAY['boolean']::text[]),
      (to_regclass('public.profiles'), 'password_reset_requested_at', ARRAY['timestamp with time zone']::text[]),
      (to_regclass('public.audit_logs'), 'user_id', ARRAY['uuid']::text[]),
      (to_regclass('public.audit_logs'), 'action_type', ARRAY['text']::text[]),
      (to_regclass('public.audit_logs'), 'entity_type', ARRAY['text']::text[]),
      (to_regclass('public.audit_logs'), 'entity_id', ARRAY['uuid']::text[]),
      (to_regclass('public.audit_logs'), 'entity_name', ARRAY['text']::text[]),
      (to_regclass('public.audit_logs'), 'new_values', ARRAY['jsonb']::text[]),
      (to_regclass('public.audit_logs'), 'description', ARRAY['text']::text[]),
      (to_regclass('public.audit_logs'), 'ip_address', ARRAY['text']::text[]),
      (to_regclass('public.audit_logs'), 'user_agent', ARRAY['text']::text[]),
      (to_regclass('storage.objects'), 'owner', ARRAY['uuid']::text[]),
      (to_regclass('storage.objects'), 'owner_id', ARRAY['text','character varying']::text[])
    ) AS required(relid, column_name, accepted_types)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_attribute AS a
      WHERE a.attrelid = required.relid AND a.attname = required.column_name
        AND a.atttypid::regtype::text = ANY(required.accepted_types) AND NOT a.attisdropped
    )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    JOIN pg_type AS t ON t.oid = a.atttypid
    WHERE a.attrelid = to_regclass('auth.one_time_tokens') AND a.attname = 'token_type'
      AND t.typtype = 'e' AND NOT a.attisdropped
      AND EXISTS (SELECT 1 FROM pg_enum AS e WHERE e.enumtypid = t.oid AND e.enumlabel = 'recovery_token')
      AND EXISTS (SELECT 1 FROM pg_enum AS e WHERE e.enumtypid = t.oid AND e.enumlabel = 'confirmation_token')
  ) OR NOT has_table_privilege('postgres', 'auth.users', 'SELECT')
    OR NOT has_table_privilege('postgres', 'auth.users', 'UPDATE')
    OR NOT has_table_privilege('postgres', 'auth.sessions', 'DELETE')
    OR NOT has_table_privilege('postgres', 'auth.one_time_tokens', 'DELETE')
    OR NOT has_table_privilege('postgres', 'public.audit_logs', 'INSERT') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_PREFLIGHT_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE nullif(u.encrypted_password, '') IS NOT NULL
      AND u.encrypted_password !~ '^\$2a\$(0[5-9]|10)\$[./A-Za-z0-9]{53}$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BCRYPT_HASH_PREFLIGHT_FAILED';
  END IF;

  v_hash := extensions.crypt('Issue 107 bcrypt compatibility probe', extensions.gen_salt('bf', 10));
  IF v_hash IS NULL OR v_hash !~ '^\$2a\$10\$[./A-Za-z0-9]{53}$'
     OR extensions.crypt('Issue 107 bcrypt compatibility probe', v_hash) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BCRYPT_PREFLIGHT_FAILED';
  END IF;

  SELECT s.enabled, s.auth_version INTO v_ok, v_version FROM account_recovery.settings AS s WHERE s.singleton;
  IF v_ok AND v_version IS DISTINCT FROM 'v2.197.0' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTH_VERSION_PREFLIGHT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('compatible', true, 'enabled', coalesce(v_ok, false));
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_enqueue_impl(
  p_job_id uuid, p_payload_cipher text, p_ip_hash text, p_ip text, p_user_agent text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_allowed boolean;
BEGIN
  IF p_job_id IS NULL OR p_payload_cipher IS NULL OR length(p_payload_cipher) = 0
     OR octet_length(p_payload_cipher) > 16384 OR p_ip_hash IS NULL
     OR length(p_ip_hash) = 0 OR length(p_ip_hash) > 128
     OR (p_ip IS NOT NULL AND (length(p_ip) > 64 OR NOT pg_input_is_valid(p_ip, 'inet')))
     OR (p_user_agent IS NOT NULL AND length(p_user_agent) > 512)
     OR NOT account_recovery.recovery_enabled() THEN
    RETURN false;
  END IF;

  BEGIN
    INSERT INTO account_recovery.rate_limits AS bucket(scope, subject, window_start, hit_count)
    VALUES ('ip', p_ip_hash, date_trunc('minute', v_now), 1)
    ON CONFLICT (scope, subject, window_start) DO UPDATE
      SET hit_count = bucket.hit_count + 1 WHERE bucket.hit_count < 10
    RETURNING true INTO v_allowed;
    IF v_allowed IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_RATE_LIMIT'; END IF;

    INSERT INTO account_recovery.rate_limits AS bucket(scope, subject, window_start, hit_count)
    VALUES ('global', 'all', date_trunc('hour', v_now), 1)
    ON CONFLICT (scope, subject, window_start) DO UPDATE
      SET hit_count = bucket.hit_count + 1 WHERE bucket.hit_count < 1000
    RETURNING true INTO v_allowed;
    IF v_allowed IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_RATE_LIMIT'; END IF;

    INSERT INTO account_recovery.deliveries(
      id, kind, state, payload_cipher, request_ip, request_user_agent, created_at, expires_at, next_attempt_at
    ) VALUES (
      p_job_id, 'request', 'queued', p_payload_cipher, p_ip, p_user_agent,
      v_now, v_now + interval '1 hour', v_now
    ) ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_DUPLICATE_JOB'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN RETURN false;
  END;
  RETURN true;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_take_delivery_impl(p_lease_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_now timestamptz;
  v_job account_recovery.deliveries%ROWTYPE;
  v_flow account_recovery.flows%ROWTYPE;
  v_expired record;
BEGIN
  IF p_lease_id IS NULL OR NOT account_recovery.recovery_enabled() THEN RETURN NULL; END IF;

  -- ponytail: one shared (105,1) lock caps dispatcher throughput; shard only if measured load warrants it.
  PERFORM pg_advisory_xact_lock(105, 1);
  v_now := clock_timestamp();

  -- Snapshot expired accounts first, then follow #105's global -> profile -> Auth -> flow -> job lock order.
  FOR v_expired IN
    SELECT f.user_id FROM account_recovery.flows AS f
    WHERE f.state = 'issued' AND f.expires_at <= v_now ORDER BY f.user_id
  LOOP
    PERFORM 1 FROM public.profiles AS p WHERE p.id = v_expired.user_id FOR UPDATE;
    PERFORM 1 FROM auth.users AS u WHERE u.id = v_expired.user_id FOR UPDATE;
    SELECT f.* INTO v_flow FROM account_recovery.flows AS f
    WHERE f.user_id = v_expired.user_id FOR UPDATE;
    IF FOUND AND v_flow.state = 'issued' AND v_flow.expires_at <= v_now THEN
      UPDATE public.profiles SET password_reset_requested_at = NULL
      WHERE id = v_expired.user_id AND password_reset_requested_at = v_flow.issued_at;
      DELETE FROM account_recovery.flows WHERE user_id = v_expired.user_id AND flow_id = v_flow.flow_id;
    END IF;
  END LOOP;

  DELETE FROM account_recovery.receipts WHERE expires_at <= v_now;
  DELETE FROM account_recovery.rate_limits WHERE window_start < v_now - interval '24 hours';

  FOR v_expired IN
    SELECT d.id, d.user_id FROM account_recovery.deliveries AS d
    WHERE d.kind = 'request' AND d.user_id IS NOT NULL AND d.expires_at > v_now
      AND d.attempt_count >= 8
      AND (d.state IN ('queued', 'retry') OR (d.state = 'leased' AND d.lease_expires_at <= v_now))
    ORDER BY d.user_id, d.id
  LOOP
    PERFORM 1 FROM public.profiles AS p WHERE p.id = v_expired.user_id FOR UPDATE;
    PERFORM 1 FROM auth.users AS u WHERE u.id = v_expired.user_id FOR UPDATE;
    SELECT f.* INTO v_flow FROM account_recovery.flows AS f WHERE f.user_id = v_expired.user_id FOR UPDATE;
    IF FOUND AND v_flow.state = 'issued' AND v_flow.flow_id = v_expired.id THEN
      UPDATE public.profiles SET password_reset_requested_at = NULL
      WHERE id = v_expired.user_id AND password_reset_requested_at = v_flow.issued_at;
      UPDATE account_recovery.flows SET state = 'invalidated', token_hash = NULL, attempt_id = NULL
      WHERE user_id = v_expired.user_id;
    END IF;
    UPDATE account_recovery.deliveries
    SET state = 'failed', payload_cipher = NULL, frozen_payload_cipher = NULL,
        request_ip = NULL, request_user_agent = NULL, lease_id = NULL, lease_expires_at = NULL
    WHERE id = v_expired.id AND expires_at > v_now AND attempt_count >= 8
      AND (state IN ('queued', 'retry') OR (state = 'leased' AND lease_expires_at <= v_now));
  END LOOP;

  UPDATE account_recovery.deliveries
  SET state = 'failed', payload_cipher = NULL, frozen_payload_cipher = NULL,
      request_ip = NULL, request_user_agent = NULL, lease_id = NULL, lease_expires_at = NULL
  WHERE expires_at > v_now AND attempt_count >= 8 AND (kind <> 'request' OR user_id IS NULL)
    AND (state IN ('queued', 'retry') OR (state = 'leased' AND lease_expires_at <= v_now));

  UPDATE account_recovery.deliveries
  SET state = 'expired', payload_cipher = NULL, frozen_payload_cipher = NULL, recipient = NULL,
      request_ip = NULL, request_user_agent = NULL, lease_id = NULL, lease_expires_at = NULL
  WHERE expires_at <= v_now AND state IN ('queued', 'retry', 'leased');
  DELETE FROM account_recovery.deliveries
  WHERE expires_at <= v_now - interval '24 hours'
    AND state IN ('sent', 'failed', 'skipped', 'expired');

  SELECT d.* INTO v_job
  FROM account_recovery.deliveries AS d
  WHERE d.expires_at > v_now AND d.attempt_count < 8 AND d.next_attempt_at <= v_now
    AND (d.state IN ('queued', 'retry') OR (d.state = 'leased' AND d.lease_expires_at <= v_now))
  ORDER BY d.next_attempt_at, d.created_at, d.id
  LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE account_recovery.deliveries
  SET state = 'leased', lease_id = p_lease_id, lease_expires_at = v_now + interval '60 seconds',
      attempt_count = attempt_count + 1
  WHERE id = v_job.id RETURNING * INTO v_job;
  RETURN jsonb_build_object(
    'id', v_job.id, 'kind', v_job.kind, 'payload_cipher', v_job.payload_cipher,
    'frozen_payload_cipher', v_job.frozen_payload_cipher,
    'flow_id', CASE WHEN v_job.kind = 'request' THEN coalesce(v_job.flow_id, v_job.id) ELSE v_job.flow_id END,
    'user_id', v_job.user_id, 'recipient', v_job.recipient, 'lease_id', p_lease_id
  );
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_freeze_delivery_impl(
  p_job_id uuid, p_lease_id uuid, p_payload_cipher text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_cipher text;
  v_lease_expires_at timestamptz;
  v_expires_at timestamptz;
  v_now timestamptz;
BEGIN
  IF p_payload_cipher IS NULL OR length(p_payload_cipher) = 0 OR octet_length(p_payload_cipher) > 65536 THEN
    RETURN NULL;
  END IF;
  SELECT d.frozen_payload_cipher, d.lease_expires_at, d.expires_at
  INTO v_cipher, v_lease_expires_at, v_expires_at
  FROM account_recovery.deliveries AS d
  WHERE d.id = p_job_id AND d.state = 'leased' AND d.lease_id = p_lease_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_now := clock_timestamp();
  IF v_lease_expires_at <= v_now OR v_expires_at <= v_now THEN RETURN NULL; END IF;
  IF v_cipher IS NULL THEN
    UPDATE account_recovery.deliveries SET frozen_payload_cipher = p_payload_cipher
    WHERE id = p_job_id AND state = 'leased' AND lease_id = p_lease_id
      AND lease_expires_at > clock_timestamp() AND expires_at > clock_timestamp()
    RETURNING frozen_payload_cipher INTO v_cipher;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  RETURN jsonb_build_object('payload_cipher', v_cipher);
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_prepare_delivery_impl(
  p_job_id uuid, p_lease_id uuid, p_email text, p_token_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_email text := lower(btrim(p_email));
  v_id uuid;
  v_profile_ids uuid[] := ARRAY[]::uuid[];
  v_auth_ids uuid[] := ARRAY[]::uuid[];
  v_profile_row public.profiles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
  v_job account_recovery.deliveries%ROWTYPE;
  v_flow account_recovery.flows%ROWTYPE;
  v_profile_count integer;
  v_auth_count integer;
  v_now timestamptz;
  v_expires timestamptz;
BEGIN
  IF NOT account_recovery.recovery_enabled()
     OR p_job_id IS NULL OR p_lease_id IS NULL OR v_email IS NULL OR v_email = ''
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'skip', 'flow_id', NULL, 'expires_at', NULL, 'user_id', NULL, 'recipient', NULL);
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT d.* INTO v_job FROM account_recovery.deliveries AS d WHERE d.id = p_job_id;
  IF NOT FOUND OR v_job.kind <> 'request' OR v_job.state <> 'leased'
     OR v_job.lease_id IS DISTINCT FROM p_lease_id OR v_job.lease_expires_at <= clock_timestamp()
      OR v_job.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'skip', 'flow_id', NULL, 'expires_at', NULL, 'user_id', NULL, 'recipient', NULL);
  END IF;

  FOR v_id IN
    SELECT p.id FROM public.profiles AS p
    WHERE lower(btrim(p.email)) = v_email ORDER BY p.id FOR UPDATE
  LOOP
    v_profile_ids := array_append(v_profile_ids, v_id);
  END LOOP;
  v_profile_count := cardinality(v_profile_ids);

  FOR v_id IN
    SELECT u.id FROM auth.users AS u
    WHERE lower(btrim(u.email)) = v_email
       OR (v_profile_count > 0 AND u.id = ANY(v_profile_ids))
    ORDER BY u.id FOR UPDATE
  LOOP
    v_auth_ids := array_append(v_auth_ids, v_id);
  END LOOP;
  SELECT count(*) INTO v_auth_count FROM auth.users AS u WHERE lower(btrim(u.email)) = v_email;

  IF v_profile_count <> 1 OR v_auth_count <> 1 THEN
    RETURN jsonb_build_object('status', 'skip', 'flow_id', NULL, 'expires_at', NULL, 'user_id', NULL, 'recipient', NULL);
  END IF;

  SELECT p.* INTO v_profile_row FROM public.profiles AS p WHERE p.id = v_profile_ids[1];
  SELECT u.* INTO v_auth FROM auth.users AS u WHERE u.id = v_profile_ids[1];
  IF NOT FOUND OR v_auth.id IS NULL OR v_profile_row.is_active IS DISTINCT FROM true
     OR coalesce(v_profile_row.auth_sync_pending, false)
     OR lower(btrim(v_auth.email)) IS DISTINCT FROM v_email
     OR lower(btrim(v_profile_row.email)) IS DISTINCT FROM v_email
     OR NOT account_recovery.recovery_auth_eligible(v_auth.id, v_email) THEN
    RETURN jsonb_build_object('status', 'skip', 'flow_id', NULL, 'expires_at', NULL, 'user_id', NULL, 'recipient', NULL);
  END IF;

  SELECT d.* INTO v_job FROM account_recovery.deliveries AS d WHERE d.id = p_job_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR v_job.kind <> 'request' OR v_job.state <> 'leased'
     OR v_job.lease_id IS DISTINCT FROM p_lease_id OR v_job.lease_expires_at <= v_now
      OR v_job.expires_at <= v_now THEN
    RETURN jsonb_build_object('status', 'skip', 'flow_id', NULL, 'expires_at', NULL, 'user_id', NULL, 'recipient', NULL);
  END IF;

  IF v_job.flow_id IS NOT NULL THEN
    IF v_job.flow_id IS DISTINCT FROM p_job_id OR v_job.user_id IS DISTINCT FROM v_profile_row.id THEN
      RETURN jsonb_build_object('status', 'skip', 'flow_id', NULL, 'expires_at', NULL, 'user_id', NULL, 'recipient', NULL);
    END IF;
    SELECT f.* INTO v_flow FROM account_recovery.flows AS f WHERE f.user_id = v_profile_row.id FOR UPDATE;
    IF NOT FOUND OR v_flow.flow_id IS DISTINCT FROM p_job_id OR v_flow.state <> 'issued'
       OR v_flow.token_hash IS DISTINCT FROM p_token_hash OR v_flow.expires_at <= v_now THEN
      RETURN jsonb_build_object('status', 'skip', 'flow_id', NULL, 'expires_at', NULL, 'user_id', NULL, 'recipient', NULL);
    END IF;
    RETURN jsonb_build_object('status', 'send', 'flow_id', v_flow.flow_id, 'expires_at', v_flow.expires_at,
      'user_id', v_profile_row.id, 'recipient', v_email);
  END IF;

  IF v_job.user_id IS NOT NULL OR v_job.issued_at IS NOT NULL
     OR (v_profile_row.password_reset_requested_at IS NOT NULL
         AND v_profile_row.password_reset_requested_at > v_now - interval '15 minutes') THEN
    RETURN jsonb_build_object('status', 'skip', 'flow_id', NULL, 'expires_at', NULL, 'user_id', NULL, 'recipient', NULL);
  END IF;

  v_expires := v_now + interval '1 hour';
  INSERT INTO account_recovery.flows(user_id, flow_id, token_hash, email, state, issued_at, expires_at)
  VALUES (v_profile_row.id, p_job_id, p_token_hash, lower(btrim(v_auth.email)), 'issued', v_now, v_expires)
  ON CONFLICT (user_id) DO UPDATE
    SET flow_id = EXCLUDED.flow_id, token_hash = EXCLUDED.token_hash, email = EXCLUDED.email,
        state = 'issued', issued_at = EXCLUDED.issued_at, expires_at = EXCLUDED.expires_at,
        attempt_id = NULL, completed_at = NULL;
  UPDATE public.profiles SET password_reset_requested_at = v_now WHERE id = v_profile_row.id;

  INSERT INTO public.audit_logs(
    user_id, action_type, entity_type, entity_id, entity_name, new_values, description, ip_address, user_agent
  ) VALUES (
    NULL, 'password_reset_requested', 'user', v_profile_row.id, v_auth.email,
    jsonb_build_object('source', 'self_recovery', 'flow_id', p_job_id),
    'Solicitare de recuperare a parolei', v_job.request_ip, v_job.request_user_agent
  );

  UPDATE account_recovery.deliveries
  SET user_id = v_profile_row.id, recipient = v_email, flow_id = p_job_id,
      issued_at = v_now, expires_at = v_expires
  WHERE id = p_job_id;

  RETURN jsonb_build_object('status', 'send', 'flow_id', p_job_id, 'expires_at', v_expires,
    'user_id', v_profile_row.id, 'recipient', v_email);
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_delivery_ready_impl(p_job_id uuid, p_lease_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_snapshot account_recovery.deliveries%ROWTYPE;
  v_job account_recovery.deliveries%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
  v_flow account_recovery.flows%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF NOT account_recovery.recovery_enabled() OR p_job_id IS NULL OR p_lease_id IS NULL THEN
    RETURN jsonb_build_object('status', 'skip', 'recipient', NULL, 'flow_id', NULL, 'expires_at', NULL);
  END IF;
  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT d.* INTO v_snapshot FROM account_recovery.deliveries AS d WHERE d.id = p_job_id;
  IF NOT FOUND OR v_snapshot.user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'skip', 'recipient', NULL, 'flow_id', NULL, 'expires_at', NULL);
  END IF;
  SELECT p.* INTO v_profile FROM public.profiles AS p WHERE p.id = v_snapshot.user_id FOR UPDATE;
  SELECT u.* INTO v_auth FROM auth.users AS u WHERE u.id = v_snapshot.user_id FOR UPDATE;

  SELECT d.* INTO v_job FROM account_recovery.deliveries AS d WHERE d.id = p_job_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR v_job.state <> 'leased' OR v_job.lease_id IS DISTINCT FROM p_lease_id
     OR v_job.lease_expires_at <= v_now OR v_job.expires_at <= v_now
     OR v_job.user_id IS DISTINCT FROM v_snapshot.user_id
     OR v_profile.id IS NULL OR v_auth.id IS NULL
     OR v_profile.is_active IS DISTINCT FROM true OR coalesce(v_profile.auth_sync_pending, false)
     OR lower(btrim(v_profile.email)) IS DISTINCT FROM lower(btrim(v_auth.email))
     OR lower(btrim(v_job.recipient)) IS DISTINCT FROM lower(btrim(v_auth.email))
     OR NOT account_recovery.recovery_auth_eligible(v_auth.id, lower(btrim(v_auth.email))) THEN
    RETURN jsonb_build_object('status', 'skip', 'recipient', NULL, 'flow_id', NULL, 'expires_at', NULL);
  END IF;

  IF v_job.kind = 'request' THEN
    IF v_job.flow_id IS DISTINCT FROM p_job_id THEN
      RETURN jsonb_build_object('status', 'skip', 'recipient', NULL, 'flow_id', NULL, 'expires_at', NULL);
    END IF;
    SELECT f.* INTO v_flow FROM account_recovery.flows AS f WHERE f.user_id = v_job.user_id FOR UPDATE;
    IF NOT FOUND OR v_flow.flow_id IS DISTINCT FROM p_job_id OR v_flow.state <> 'issued'
       OR v_flow.token_hash IS NULL OR v_flow.expires_at <= v_now THEN
      RETURN jsonb_build_object('status', 'skip', 'recipient', NULL, 'flow_id', NULL, 'expires_at', NULL);
    END IF;
  ELSE
    IF v_job.kind <> 'confirmation' OR v_job.flow_id IS NULL OR v_job.attempt_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM account_recovery.receipts AS r
         WHERE r.flow_id = v_job.flow_id AND r.attempt_id = v_job.attempt_id AND r.expires_at > v_now
       ) THEN
      RETURN jsonb_build_object('status', 'skip', 'recipient', NULL, 'flow_id', NULL, 'expires_at', NULL);
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'send', 'recipient', v_job.recipient,
    'flow_id', CASE WHEN v_job.kind = 'request' THEN coalesce(v_job.flow_id, v_job.id) ELSE v_job.flow_id END,
    'expires_at', v_job.expires_at);
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_finish_delivery_impl(
  p_job_id uuid, p_lease_id uuid, p_outcome text, p_provider_id text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_snapshot account_recovery.deliveries%ROWTYPE;
  v_job account_recovery.deliveries%ROWTYPE;
  v_flow account_recovery.flows%ROWTYPE;
  v_now timestamptz;
  v_delay double precision;
  v_state text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'failed', 'retry', 'skipped') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_RECOVERY_OUTCOME';
  END IF;
  IF p_provider_id IS NOT NULL AND length(p_provider_id) > 256 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PROVIDER_ID';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  v_now := clock_timestamp();
  SELECT d.* INTO v_snapshot FROM account_recovery.deliveries AS d WHERE d.id = p_job_id;
  IF NOT FOUND OR v_snapshot.state <> 'leased' OR v_snapshot.lease_id IS DISTINCT FROM p_lease_id
     OR v_snapshot.lease_expires_at <= v_now THEN RETURN; END IF;

  v_state := p_outcome;
  IF p_outcome = 'retry' AND (v_snapshot.attempt_count >= 8 OR v_snapshot.expires_at <= v_now) THEN
    v_state := 'failed';
  END IF;

  IF v_snapshot.kind = 'request' AND v_snapshot.user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles AS p WHERE p.id = v_snapshot.user_id FOR UPDATE;
    PERFORM 1 FROM auth.users AS u WHERE u.id = v_snapshot.user_id FOR UPDATE;
  END IF;
  IF v_state = 'failed' AND v_snapshot.kind = 'request'
     AND v_snapshot.user_id IS NOT NULL AND v_snapshot.flow_id = v_snapshot.id THEN
    SELECT f.* INTO v_flow FROM account_recovery.flows AS f WHERE f.user_id = v_snapshot.user_id FOR UPDATE;
  END IF;

  SELECT d.* INTO v_job FROM account_recovery.deliveries AS d WHERE d.id = p_job_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR v_job.state <> 'leased' OR v_job.lease_id IS DISTINCT FROM p_lease_id
     OR v_job.lease_expires_at <= v_now THEN RETURN; END IF;

  IF v_state = 'failed' AND v_job.kind = 'request'
     AND v_job.user_id IS NOT NULL AND v_job.flow_id = v_job.id
     AND v_flow.flow_id = v_job.id AND v_flow.state = 'issued' AND v_flow.token_hash IS NOT NULL THEN
    UPDATE account_recovery.flows
    SET state = 'invalidated', token_hash = NULL, attempt_id = NULL WHERE user_id = v_job.user_id;
    UPDATE public.profiles SET password_reset_requested_at = NULL
    WHERE id = v_job.user_id AND password_reset_requested_at = v_flow.issued_at;
  END IF;

  IF v_state = 'retry' THEN
    v_delay := least(3600.0, 15.0 * power(2.0, least(v_job.attempt_count - 1, 8)));
    UPDATE account_recovery.deliveries
    SET state = 'retry', next_attempt_at = v_now + make_interval(secs => v_delay),
        lease_id = NULL, lease_expires_at = NULL, provider_id = p_provider_id
    WHERE id = p_job_id;
  ELSE
    UPDATE account_recovery.deliveries
    SET state = v_state, payload_cipher = NULL, frozen_payload_cipher = NULL,
        request_ip = NULL, request_user_agent = NULL, lease_id = NULL, lease_expires_at = NULL,
        provider_id = p_provider_id
    WHERE id = p_job_id;
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_inspect_impl(
  p_flow_id uuid, p_token_hash text, p_attempt_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_user_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
  v_flow account_recovery.flows%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_flow_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF p_attempt_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM account_recovery.receipts AS r
    WHERE r.flow_id = p_flow_id AND r.token_hash = p_token_hash
      AND r.attempt_id = p_attempt_id AND r.expires_at > clock_timestamp()
  ) THEN RETURN jsonb_build_object('status', 'completed'); END IF;
  IF NOT account_recovery.recovery_enabled() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_DISABLED';
  END IF;

  SELECT f.user_id INTO v_user_id FROM account_recovery.flows AS f
  WHERE f.flow_id = p_flow_id AND f.token_hash = p_token_hash AND f.state = 'issued';
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT p.* INTO v_profile FROM public.profiles AS p WHERE p.id = v_user_id FOR SHARE;
  SELECT u.* INTO v_auth FROM auth.users AS u WHERE u.id = v_user_id FOR SHARE;
  SELECT f.* INTO v_flow FROM account_recovery.flows AS f WHERE f.user_id = v_user_id FOR SHARE;
  v_now := clock_timestamp();

  IF NOT FOUND OR v_flow.flow_id IS DISTINCT FROM p_flow_id OR v_flow.token_hash IS DISTINCT FROM p_token_hash
     OR v_flow.state <> 'issued' OR v_flow.expires_at <= v_now
     OR v_profile.id IS NULL OR v_auth.id IS NULL OR v_profile.is_active IS DISTINCT FROM true
     OR coalesce(v_profile.auth_sync_pending, false)
     OR lower(btrim(v_profile.email)) IS DISTINCT FROM lower(btrim(v_auth.email))
     OR NOT account_recovery.recovery_auth_eligible(v_auth.id, lower(btrim(v_auth.email))) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  RETURN jsonb_build_object('status', 'valid', 'flow_id', v_flow.flow_id, 'expires_at', v_flow.expires_at);
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_complete_impl(
  p_flow_id uuid, p_token_hash text, p_attempt_id uuid, p_password text, p_ip text, p_user_agent text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_user_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
  v_flow account_recovery.flows%ROWTYPE;
  v_now timestamptz;
  v_new_hash text;
BEGIN
  IF p_flow_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_attempt_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF EXISTS (
    SELECT 1 FROM account_recovery.receipts AS r
    WHERE r.flow_id = p_flow_id AND r.token_hash = p_token_hash
      AND r.attempt_id = p_attempt_id AND r.expires_at > clock_timestamp()
  ) THEN RETURN jsonb_build_object('status', 'receipt'); END IF;
  IF NOT account_recovery.recovery_enabled() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_DISABLED';
  END IF;
  IF (p_ip IS NOT NULL AND (length(p_ip) > 64 OR NOT pg_input_is_valid(p_ip, 'inet')))
     OR (p_user_agent IS NOT NULL AND length(p_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_RECOVERY_METADATA';
  END IF;

  PERFORM pg_advisory_xact_lock(105, 1);
  IF EXISTS (
    SELECT 1 FROM account_recovery.receipts AS r
    WHERE r.flow_id = p_flow_id AND r.token_hash = p_token_hash
      AND r.attempt_id = p_attempt_id AND r.expires_at > clock_timestamp()
  ) THEN RETURN jsonb_build_object('status', 'receipt'); END IF;

  SELECT f.user_id INTO v_user_id FROM account_recovery.flows AS f
  WHERE f.flow_id = p_flow_id AND f.token_hash = p_token_hash AND f.state = 'issued';
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;

  SELECT p.* INTO v_profile FROM public.profiles AS p WHERE p.id = v_user_id FOR UPDATE;
  SELECT u.* INTO v_auth FROM auth.users AS u WHERE u.id = v_user_id FOR UPDATE;
  SELECT f.* INTO v_flow FROM account_recovery.flows AS f WHERE f.user_id = v_user_id FOR UPDATE;
  v_now := clock_timestamp();

  IF NOT FOUND OR v_flow.flow_id IS DISTINCT FROM p_flow_id OR v_flow.token_hash IS DISTINCT FROM p_token_hash
     OR v_flow.state <> 'issued' OR v_flow.expires_at <= v_now
     OR v_profile.id IS NULL OR v_auth.id IS NULL OR v_profile.is_active IS DISTINCT FROM true
     OR coalesce(v_profile.auth_sync_pending, false)
     OR lower(btrim(v_profile.email)) IS DISTINCT FROM lower(btrim(v_auth.email))
     OR lower(btrim(v_auth.email)) IS DISTINCT FROM v_flow.email
     OR NOT account_recovery.recovery_auth_eligible(v_auth.id, v_flow.email) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF p_password IS NULL OR char_length(p_password) < 6 OR octet_length(p_password) > 72 THEN
    RETURN jsonb_build_object('status', 'password_invalid');
  END IF;
  BEGIN
    IF extensions.crypt(p_password, v_auth.encrypted_password) = v_auth.encrypted_password THEN
      RETURN jsonb_build_object('status', 'same_password');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'invalid');
  END;

  v_new_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
  IF v_new_hash IS NULL OR v_new_hash !~ '^\$2a\$10\$[./A-Za-z0-9]{53}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_BCRYPT_PREFLIGHT_FAILED';
  END IF;

  PERFORM set_config('bonie.recovery_finalizing_user', v_user_id::text, true);
  UPDATE auth.users
  SET encrypted_password = v_new_hash, updated_at = v_now,
      confirmation_token = '', confirmation_sent_at = NULL, recovery_token = '', recovery_sent_at = NULL,
      email_change_token_new = '', email_change_token_current = '', email_change_sent_at = NULL,
      phone_change_token = '', phone_change_sent_at = NULL,
      reauthentication_token = '', reauthentication_sent_at = NULL
  WHERE id = v_user_id;

  DELETE FROM auth.one_time_tokens WHERE user_id = v_user_id;
  DELETE FROM auth.sessions WHERE user_id = v_user_id;
  UPDATE public.profiles SET must_change_password = false WHERE id = v_user_id;
  UPDATE account_recovery.flows
  SET state = 'completed', token_hash = NULL, attempt_id = p_attempt_id, completed_at = v_now
  WHERE user_id = v_user_id;

  INSERT INTO account_recovery.receipts(flow_id, user_id, token_hash, attempt_id, completed_at, expires_at)
  VALUES (p_flow_id, v_user_id, p_token_hash, p_attempt_id, v_now, v_now + interval '24 hours');

  INSERT INTO public.audit_logs(
    user_id, action_type, entity_type, entity_id, entity_name, new_values, description, ip_address, user_agent
  ) VALUES (
    v_user_id, 'password_reset_completed', 'user', v_user_id, v_auth.email,
    jsonb_build_object('source', 'self_recovery', 'attempt_id', p_attempt_id),
    'Parola schimbată prin recuperarea proprie', p_ip, p_user_agent
  );

  -- Confirmation is queued in this commit; its server-encrypted rendered bytes are frozen by the worker.
  INSERT INTO account_recovery.deliveries(
    id, kind, state, user_id, recipient, flow_id, attempt_id, created_at, expires_at, next_attempt_at
  ) VALUES (
    gen_random_uuid(), 'confirmation', 'queued', v_user_id, lower(btrim(v_auth.email)), p_flow_id, p_attempt_id,
    v_now, v_now + interval '24 hours', v_now
  );

  RETURN jsonb_build_object('status', 'completed', 'user_id', v_user_id, 'email', v_auth.email);
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_invalidate_account_impl(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(105, 1);
  PERFORM 1 FROM public.profiles AS p WHERE p.id = p_user_id FOR UPDATE;
  PERFORM 1 FROM auth.users AS u WHERE u.id = p_user_id FOR UPDATE;
  PERFORM account_recovery.invalidate_account_recovery_state(p_user_id, true);
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_profile_change_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_marker_write boolean := false;
BEGIN
  IF TG_NARGS > 0 THEN v_marker_write := TG_ARGV[0] = 'marker'; END IF;
  IF (v_marker_write AND NEW.must_change_password IS TRUE)
     OR (NOT v_marker_write AND (
       NEW.is_active IS DISTINCT FROM OLD.is_active
       OR lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email))
     )) THEN
    PERFORM 1 FROM auth.users AS u WHERE u.id = NEW.id FOR UPDATE;
    PERFORM account_recovery.invalidate_account_recovery_state(NEW.id, false);
    NEW.password_reset_requested_at := NULL;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.recovery_auth_change_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  IF current_setting('bonie.recovery_finalizing_user', true) = NEW.id::text THEN RETURN NEW; END IF;

  IF session_user = 'supabase_auth_admin' AND account_recovery.recovery_enabled()
     AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PASSWORD_CHANGE_REQUIRES_ATOMIC_PATH';
  END IF;

  IF lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email))
     OR NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    PERFORM account_recovery.invalidate_account_recovery_state(NEW.id, true);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.native_email_credential_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  IF session_user = 'supabase_auth_admin' AND account_recovery.recovery_enabled() THEN
    NEW.recovery_token := ''; NEW.recovery_sent_at := NULL;
    NEW.confirmation_token := ''; NEW.confirmation_sent_at := NULL;
    NEW.email_change_token_new := ''; NEW.email_change_token_current := ''; NEW.email_change_sent_at := NULL;
    NEW.phone_change_token := ''; NEW.phone_change_sent_at := NULL;
    NEW.reauthentication_token := ''; NEW.reauthentication_sent_at := NULL;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION account_recovery.native_email_token_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  IF session_user = 'supabase_auth_admin' AND account_recovery.recovery_enabled() THEN RETURN NULL; END IF;
  RETURN NEW;
END
$fn$;

-- Configure this invoker/auth-only hook only after external preflight; native proof persistence is blocked independently of recovery-flow rows.
CREATE OR REPLACE FUNCTION account_recovery.send_email_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $fn$
BEGIN
  -- Empty response suppresses native recovery/magiclink delivery; never log the event or token.
  RETURN '{}'::jsonb;
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_preflight()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.recovery_preflight_impl();
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_enqueue(
  p_job_id uuid, p_payload_cipher text, p_ip_hash text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.recovery_enqueue_impl(p_job_id, p_payload_cipher, p_ip_hash, p_ip, p_user_agent);
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_take_delivery(p_lease_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.recovery_take_delivery_impl(p_lease_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_freeze_delivery(p_job_id uuid, p_lease_id uuid, p_payload_cipher text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.recovery_freeze_delivery_impl(p_job_id, p_lease_id, p_payload_cipher);
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_prepare_delivery(
  p_job_id uuid, p_lease_id uuid, p_email text, p_token_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.recovery_prepare_delivery_impl(p_job_id, p_lease_id, p_email, p_token_hash);
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_delivery_ready(p_job_id uuid, p_lease_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.recovery_delivery_ready_impl(p_job_id, p_lease_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_finish_delivery(
  p_job_id uuid, p_lease_id uuid, p_outcome text, p_provider_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  PERFORM account_recovery.recovery_finish_delivery_impl(p_job_id, p_lease_id, p_outcome, p_provider_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_inspect(
  p_flow_id uuid, p_token_hash text, p_attempt_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.recovery_inspect_impl(p_flow_id, p_token_hash, p_attempt_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.recovery_complete(
  p_flow_id uuid, p_token_hash text, p_attempt_id uuid, p_password text,
  p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN account_recovery.recovery_complete_impl(p_flow_id, p_token_hash, p_attempt_id, p_password, p_ip, p_user_agent);
END
$fn$;

CREATE OR REPLACE FUNCTION public.invalidate_account_recovery(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  PERFORM account_recovery.recovery_invalidate_account_impl(p_user_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.activate_account_recovery(p_verified_auth_version text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_preflight jsonb;
  v_enabled boolean;
BEGIN
  IF p_verified_auth_version IS DISTINCT FROM 'v2.197.0' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTH_VERSION_PREFLIGHT_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(105, 1);
  SELECT s.enabled INTO v_enabled FROM account_recovery.settings AS s WHERE s.singleton FOR UPDATE;
  IF v_enabled THEN RETURN; END IF;

  v_preflight := account_recovery.recovery_preflight_impl();
  IF v_preflight ->> 'compatible' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECOVERY_PREFLIGHT_FAILED';
  END IF;

  UPDATE auth.users
  SET recovery_token = '', recovery_sent_at = NULL, confirmation_token = '', confirmation_sent_at = NULL,
      email_change_token_new = '', email_change_token_current = '', email_change_sent_at = NULL,
      phone_change_token = '', phone_change_sent_at = NULL,
      reauthentication_token = '', reauthentication_sent_at = NULL;
  DELETE FROM auth.one_time_tokens;
  DELETE FROM auth.sessions;
  UPDATE account_recovery.settings
  SET enabled = true, auth_version = p_verified_auth_version, activated_at = clock_timestamp()
  WHERE singleton;
END
$fn$;

-- Profile email/marker and Auth email/password writes take the #105 lock first.
DROP TRIGGER IF EXISTS issue107_recovery_profile_lock ON public.profiles;
CREATE TRIGGER issue107_recovery_profile_lock
BEFORE UPDATE OF email, must_change_password ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION public.issue105_acquire_account_lock();

DROP TRIGGER IF EXISTS issue107_recovery_profile_change ON public.profiles;
CREATE TRIGGER issue107_recovery_profile_change
BEFORE UPDATE OF email, is_active ON public.profiles
FOR EACH ROW EXECUTE FUNCTION account_recovery.recovery_profile_change_guard();

DROP TRIGGER IF EXISTS issue107_recovery_profile_marker_change ON public.profiles;
CREATE TRIGGER issue107_recovery_profile_marker_change
BEFORE UPDATE OF must_change_password ON public.profiles
FOR EACH ROW EXECUTE FUNCTION account_recovery.recovery_profile_change_guard('marker');

DROP TRIGGER IF EXISTS issue107_recovery_auth_lock ON auth.users;
CREATE TRIGGER issue107_recovery_auth_lock
BEFORE UPDATE OF email, encrypted_password ON auth.users
FOR EACH STATEMENT EXECUTE FUNCTION public.issue105_acquire_account_lock();

DROP TRIGGER IF EXISTS issue107_recovery_auth_change ON auth.users;
CREATE TRIGGER issue107_recovery_auth_change
BEFORE UPDATE OF email, encrypted_password ON auth.users
FOR EACH ROW EXECUTE FUNCTION account_recovery.recovery_auth_change_guard();

-- Auth v2.197.0 pgcrypto compatibility is limited to $2a$ bcrypt: existing costs 05-10 remain unchanged. Native password writes stay blocked after activation; recheck this adapter on upgrades.
-- Native proof persistence is gated for every Auth account regardless of recovery flow. Confirmed admin creation is preserved because email_confirmed_at is untouched; Auth-native one_time_tokens writes are suppressed.
DROP TRIGGER IF EXISTS issue107_native_auth_email_insert ON auth.users;
CREATE TRIGGER issue107_native_auth_email_insert
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION account_recovery.native_email_credential_gate();

DROP TRIGGER IF EXISTS issue107_native_auth_email_update ON auth.users;
CREATE TRIGGER issue107_native_auth_email_update
BEFORE UPDATE OF recovery_token, recovery_sent_at, confirmation_token, confirmation_sent_at,
  email_change_token_new, email_change_token_current, email_change_sent_at,
  phone_change_token, phone_change_sent_at, reauthentication_token, reauthentication_sent_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION account_recovery.native_email_credential_gate();

DROP TRIGGER IF EXISTS issue107_native_one_time_tokens ON auth.one_time_tokens;
CREATE TRIGGER issue107_native_one_time_tokens
BEFORE INSERT OR UPDATE ON auth.one_time_tokens
FOR EACH ROW EXECUTE FUNCTION account_recovery.native_email_token_gate();

-- Preserve #105 login/logout handling and exempt only this actor's exact own completed recovery.
CREATE OR REPLACE FUNCTION public.user_account_blockers(p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
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
  IF p_target_id IS NULL THEN RETURN v_blockers; END IF;
  FOR v_fk IN
    SELECT c.conrelid, c.confrelid, child_ns.nspname AS child_schema, child.relname AS child_table,
           parent_ns.nspname AS parent_schema, parent.relname AS parent_table, c.conkey, c.confkey, c.conname
    FROM pg_constraint AS c
    JOIN pg_class AS child ON child.oid = c.conrelid
    JOIN pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class AS parent ON parent.oid = c.confrelid
    JOIN pg_namespace AS parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE c.contype = 'f' AND child_ns.nspname = 'public'
      AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
      AND c.conrelid <> 'public.audit_logs'::regclass
      AND NOT (
        c.conrelid = 'public.profiles'::regclass AND c.confrelid = 'auth.users'::regclass
        AND cardinality(c.conkey) = 1 AND cardinality(c.confkey) = 1
        AND EXISTS (
          SELECT 1 FROM pg_attribute AS child_id
          JOIN pg_attribute AS auth_id ON auth_id.attrelid = c.confrelid AND auth_id.attnum = c.confkey[1]
          WHERE child_id.attrelid = c.conrelid AND child_id.attnum = c.conkey[1]
            AND child_id.attname = 'id' AND auth_id.attname = 'id'
        )
      )
    ORDER BY child_ns.nspname, child.relname, c.conname
  LOOP
    SELECT
      string_agg(format('r.%I = p.%I', child_attr.attname, parent_attr.attname), ' AND ' ORDER BY keys.ord),
      string_agg(child_attr.attname, ',' ORDER BY keys.ord)
    INTO v_join_condition, v_fields
    FROM unnest(v_fk.conkey, v_fk.confkey) WITH ORDINALITY AS keys(child_attnum, parent_attnum, ord)
    JOIN pg_attribute AS child_attr ON child_attr.attrelid = v_fk.conrelid AND child_attr.attnum = keys.child_attnum
    JOIN pg_attribute AS parent_attr ON parent_attr.attrelid = v_fk.confrelid AND parent_attr.attnum = keys.parent_attnum;

    v_kind := format('%s.%s.%s', v_fk.child_schema, v_fk.child_table, v_fields);
    IF v_kind = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := array_append(v_seen, v_kind);
    EXECUTE format(
      'SELECT count(*) FROM %I.%I AS r WHERE EXISTS (' ||
      'SELECT 1 FROM %I.%I AS p WHERE p.id = $1 AND %s)',
      v_fk.child_schema, v_fk.child_table, v_fk.parent_schema, v_fk.parent_table, v_join_condition
    ) INTO v_count USING p_target_id;
    IF v_count > 0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('kind', v_kind, 'count', v_count));
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count FROM public.audit_logs
  WHERE user_id = p_target_id
    AND (
      action_type = 'password_reset_completed' AND entity_type = 'user'
      AND entity_id = p_target_id AND new_values ->> 'source' = 'self_recovery'
    ) IS NOT TRUE
    AND (
      action_type IN ('login', 'logout') AND entity_type = 'user'
      AND (entity_id = p_target_id OR entity_id IS NULL)
    ) IS NOT TRUE;
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('kind', 'public.audit_logs.user_id', 'count', v_count));
  END IF;

  SELECT count(*) INTO v_count FROM storage.objects AS o
  WHERE o.owner = p_target_id OR CASE
    WHEN pg_input_is_valid(o.owner_id, 'uuid') THEN o.owner_id::uuid = p_target_id ELSE false END;
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('kind', 'storage.objects.owner/owner_id', 'count', v_count));
  END IF;
  RETURN v_blockers;
END
$function$;

REVOKE ALL ON FUNCTION public.user_account_blockers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_account_blockers(uuid) TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA account_recovery FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION account_recovery.send_email_hook(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION account_recovery.send_email_hook(jsonb) TO supabase_auth_admin;

REVOKE ALL ON FUNCTION public.recovery_preflight() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recovery_enqueue(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recovery_take_delivery(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recovery_freeze_delivery(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recovery_prepare_delivery(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recovery_delivery_ready(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recovery_finish_delivery(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recovery_inspect(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recovery_complete(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_account_recovery(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_account_recovery(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.recovery_preflight() TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_enqueue(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_take_delivery(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_freeze_delivery(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_prepare_delivery(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_delivery_ready(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_finish_delivery(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_inspect(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_complete(uuid, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_account_recovery(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_account_recovery(text) TO service_role;
