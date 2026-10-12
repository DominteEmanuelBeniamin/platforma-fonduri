-- Preserve issued proofs and cooldowns when the delivery retry budget is exhausted.

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

  -- A lost response or lease does not prove that the email was rejected.
  UPDATE account_recovery.deliveries
  SET state = 'failed', payload_cipher = NULL, frozen_payload_cipher = NULL,
      request_ip = NULL, request_user_agent = NULL, lease_id = NULL, lease_expires_at = NULL
  WHERE expires_at > v_now AND attempt_count >= 8
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

  -- Only a certain refusal can revoke a possibly delivered proof.
  v_state := p_outcome;
  IF p_outcome = 'retry' AND (v_snapshot.attempt_count >= 8 OR v_snapshot.expires_at <= v_now) THEN
    v_state := 'failed';
  END IF;

  IF v_snapshot.kind = 'request' AND v_snapshot.user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles AS p WHERE p.id = v_snapshot.user_id FOR UPDATE;
    PERFORM 1 FROM auth.users AS u WHERE u.id = v_snapshot.user_id FOR UPDATE;
  END IF;
  IF p_outcome = 'failed' AND v_snapshot.kind = 'request'
     AND v_snapshot.user_id IS NOT NULL AND v_snapshot.flow_id = v_snapshot.id THEN
    SELECT f.* INTO v_flow FROM account_recovery.flows AS f WHERE f.user_id = v_snapshot.user_id FOR UPDATE;
  END IF;

  SELECT d.* INTO v_job FROM account_recovery.deliveries AS d WHERE d.id = p_job_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR v_job.state <> 'leased' OR v_job.lease_id IS DISTINCT FROM p_lease_id
     OR v_job.lease_expires_at <= v_now THEN RETURN; END IF;

  IF p_outcome = 'failed' AND v_job.kind = 'request'
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
