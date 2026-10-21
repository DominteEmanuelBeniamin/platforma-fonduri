-- Run against the dedicated local stack; every fixture is rolled back.
BEGIN;
SET LOCAL statement_timeout = '10s';

DO $test$
DECLARE
  actor_id uuid := gen_random_uuid();
  conversation_id uuid := gen_random_uuid();
  message_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (
    actor_id,
    'private-edit-sql.' || actor_id || '@example.invalid',
    '{"full_name":"Private edit regression"}',
    '{"provider":"email","providers":["email"]}'
  );
  INSERT INTO auth.sessions (id, user_id) VALUES (session_id, actor_id);
  INSERT INTO public.private_conversations (id, created_by)
  VALUES (conversation_id, actor_id);
  INSERT INTO public.private_conversation_participants (conversation_id, user_id)
  VALUES (conversation_id, actor_id);
  INSERT INTO public.private_messages (id, conversation_id, created_by, body, created_at)
  VALUES (message_id, conversation_id, actor_id, 'initial', '2099-01-01 00:00:00.123456+00');

  PERFORM set_config('test.private_edit_message_id', message_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', actor_id, 'role', 'authenticated', 'session_id', session_id)::text, true);
END;
$test$;

-- The trigger must work under the existing RLS policies and without a grant
-- to call its function directly.
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  message_id uuid := current_setting('test.private_edit_message_id')::uuid;
  previous_version timestamptz := '2099-01-01 00:00:00.123456+00';
  saved_version timestamptz;
  ordinary_message_id uuid;
  before_edit timestamptz;
BEGIN
  UPDATE public.private_messages SET body = 'first edit', edited_at = '1970-01-01+00'
  WHERE id = message_id RETURNING edited_at INTO saved_version;
  IF saved_version IS DISTINCT FROM previous_version + interval '1 microsecond' THEN
    RAISE EXCEPTION 'First edit must follow created_at at microsecond precision: %', saved_version;
  END IF;
  previous_version := saved_version;

  UPDATE public.private_messages SET body = 'second edit', edited_at = '1970-01-01+00'
  WHERE id = message_id RETURNING edited_at INTO saved_version;
  IF saved_version IS DISTINCT FROM previous_version + interval '1 microsecond' THEN
    RAISE EXCEPTION 'Next edit must follow the persisted version despite a stale supplied timestamp: %', saved_version;
  END IF;
  previous_version := saved_version;

  UPDATE public.private_messages SET body = body
  WHERE id = message_id RETURNING edited_at INTO saved_version;
  IF saved_version IS DISTINCT FROM previous_version + interval '1 microsecond' THEN
    RAISE EXCEPTION 'A saved body update must advance even when its text is unchanged';
  END IF;
  previous_version := saved_version;

  UPDATE public.private_messages SET deleted_at = clock_timestamp()
  WHERE id = message_id RETURNING edited_at INTO saved_version;
  IF saved_version IS DISTINCT FROM previous_version THEN
    RAISE EXCEPTION 'Deleting a message must not change its edit version';
  END IF;

  INSERT INTO public.private_messages (conversation_id, created_by, body, created_at)
  SELECT conversation_id, created_by, 'ordinary initial', clock_timestamp() - interval '1 hour'
  FROM public.private_messages WHERE id = message_id
  RETURNING id INTO ordinary_message_id;
  before_edit := clock_timestamp();
  UPDATE public.private_messages SET body = 'ordinary edit'
  WHERE id = ordinary_message_id RETURNING edited_at INTO saved_version;
  IF saved_version IS NULL OR saved_version < before_edit THEN
    RAISE EXCEPTION 'A normal edit must use actual write time, not transaction start time';
  END IF;
  RAISE NOTICE 'PASS: DB edit versions advance by microseconds, work under RLS, and ignore deletion-only updates';
END;
$test$;

ROLLBACK;
