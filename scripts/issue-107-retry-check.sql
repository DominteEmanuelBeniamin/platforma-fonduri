-- Dedicated local regression check. Every fixture and setting change is rolled back.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL log_parameter_max_length_on_error = 0;
UPDATE account_recovery.settings SET enabled = true WHERE singleton;

DO $check$
DECLARE
  v_user uuid := gen_random_uuid();
  v_flow uuid := gen_random_uuid();
  v_next uuid := gen_random_uuid();
  v_lease uuid := gen_random_uuid();
  v_issued timestamptz := clock_timestamp();
  v_hash text := repeat('a', 64);
BEGIN
  INSERT INTO auth.users(id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
  VALUES (v_user, 'issue107.retry.' || v_user || '@example.invalid',
    extensions.crypt('Fixture-only-' || v_user, extensions.gen_salt('bf', 10)), v_issued,
    '{"provider":"email","providers":["email"]}'::jsonb, v_issued, v_issued);
  UPDATE public.profiles SET is_active = true, password_reset_requested_at = v_issued WHERE id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture profile missing'; END IF;
  INSERT INTO account_recovery.flows(user_id, flow_id, token_hash, email, state, issued_at, expires_at)
  VALUES (v_user, v_flow, v_hash, 'issue107.retry.' || v_user || '@example.invalid', 'issued', v_issued, v_issued + interval '1 hour');
  INSERT INTO account_recovery.deliveries(id, kind, state, payload_cipher, frozen_payload_cipher, user_id, flow_id,
    issued_at, expires_at, attempt_count, lease_id, lease_expires_at)
  VALUES (v_flow, 'request', 'leased', 'fixture', 'fixture', v_user, v_flow,
    v_issued, v_issued + interval '1 hour', 8, v_lease, clock_timestamp() + interval '1 minute');

  PERFORM public.recovery_finish_delivery(v_flow, v_lease, 'retry');
  IF public.recovery_inspect(v_flow, v_hash)->>'status' IS DISTINCT FROM 'valid'
     OR (SELECT password_reset_requested_at FROM public.profiles WHERE id = v_user) IS DISTINCT FROM v_issued THEN
    RAISE EXCEPTION 'Unknown outcome at attempt eight must preserve the proof and cooldown';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account_recovery.deliveries WHERE id = v_flow AND state = 'failed'
      AND payload_cipher IS NULL AND frozen_payload_cipher IS NULL AND lease_id IS NULL) THEN
    RAISE EXCEPTION 'Exhausted delivery must stop and wipe its payload';
  END IF;

  UPDATE account_recovery.deliveries SET state = 'leased', payload_cipher = 'fixture', frozen_payload_cipher = 'fixture',
    lease_id = v_lease, lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = v_flow;
  PERFORM public.recovery_take_delivery(gen_random_uuid());
  IF public.recovery_inspect(v_flow, v_hash)->>'status' IS DISTINCT FROM 'valid'
     OR (SELECT password_reset_requested_at FROM public.profiles WHERE id = v_user) IS DISTINCT FROM v_issued
     OR (SELECT state FROM account_recovery.deliveries WHERE id = v_flow) IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'Expired lease at attempt eight must stop delivery without revoking the proof';
  END IF;

  UPDATE account_recovery.flows SET flow_id = v_next WHERE user_id = v_user;
  UPDATE account_recovery.deliveries SET state = 'leased', payload_cipher = 'fixture',
    lease_id = v_lease, lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = v_flow;
  PERFORM public.recovery_take_delivery(gen_random_uuid());
  IF public.recovery_inspect(v_next, v_hash)->>'status' IS DISTINCT FROM 'valid'
     OR (SELECT password_reset_requested_at FROM public.profiles WHERE id = v_user) IS DISTINCT FROM v_issued THEN
    RAISE EXCEPTION 'Exhaustion of an old delivery must preserve the current generation';
  END IF;

  INSERT INTO account_recovery.deliveries(id, kind, state, payload_cipher, user_id, flow_id,
    issued_at, expires_at, attempt_count, lease_id, lease_expires_at)
  VALUES (v_next, 'request', 'leased', 'fixture', v_user, v_next,
    v_issued, v_issued + interval '1 hour', 8, v_lease, clock_timestamp() + interval '1 minute');
  PERFORM public.recovery_finish_delivery(v_next, v_lease, 'failed');
  IF public.recovery_inspect(v_next, v_hash)->>'status' IS DISTINCT FROM 'invalid'
     OR (SELECT password_reset_requested_at FROM public.profiles WHERE id = v_user) IS NOT NULL THEN
    RAISE EXCEPTION 'Certain refusal must still invalidate only its proof and clear its cooldown';
  END IF;

  UPDATE account_recovery.flows SET state = 'issued', token_hash = v_hash,
    expires_at = clock_timestamp() - interval '1 second' WHERE user_id = v_user;
  UPDATE public.profiles SET password_reset_requested_at = v_issued WHERE id = v_user;
  UPDATE account_recovery.deliveries SET state = 'leased', payload_cipher = 'fixture',
    lease_id = v_lease, lease_expires_at = clock_timestamp() - interval '1 second',
    expires_at = clock_timestamp() - interval '1 second' WHERE id = v_next;
  PERFORM public.recovery_take_delivery(gen_random_uuid());
  IF public.recovery_inspect(v_next, v_hash)->>'status' IS DISTINCT FROM 'invalid'
     OR (SELECT password_reset_requested_at FROM public.profiles WHERE id = v_user) IS NOT NULL
     OR (SELECT state FROM account_recovery.deliveries WHERE id = v_next) IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'Normal expiry must still remove the proof and cooldown';
  END IF;
  RAISE NOTICE 'Recovery retry regressions passed';
END;
$check$;
ROLLBACK;
