-- Issue #108 review: revalidate Auth restrictions and reconcile abandoned delivery attempts.
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
  JOIN auth.users AS u ON u.id = s.user_id
  WHERE s.id = p_session_id
    AND s.user_id = p_actor_id
    AND (s.not_after IS NULL OR s.not_after > v_now)
    AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until <= v_now)
  FOR KEY SHARE OF s;
  RETURN FOUND;
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

  v_now := clock_timestamp();
  -- One minute exceeds the bounded RPC/provider calls; active handoffs stay untouched.
  IF v_receipt.delivery_finished_at IS NULL AND (
    (v_receipt.delivery_status = 'unknown' AND p_outcome IS NOT NULL)
    OR (v_receipt.delivery_status = 'pending' AND p_outcome = 'unknown')
    -- prepare never committed, so the provider was never called: a certain failure.
    OR (v_receipt.delivery_status = 'pending' AND p_outcome = 'failed' AND p_reason = 'delivery_not_started')
    OR (p_outcome IS NULL AND coalesce(v_receipt.delivery_started_at, v_receipt.created_at)
        <= v_now - interval '1 minute')
  ) THEN
    UPDATE account_recovery.admin_password_resets
    SET delivery_status = coalesce(p_outcome, 'unknown'),
        delivery_reason = CASE WHEN p_outcome IS NULL THEN 'provider_unconfirmed' ELSE p_reason END,
        provider_id = CASE WHEN p_outcome IS NULL THEN NULL ELSE p_provider_id END,
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
