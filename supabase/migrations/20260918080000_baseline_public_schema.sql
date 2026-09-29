


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."acquire_reminder_run_lease"("p_lease_name" "text", "p_owner_id" "uuid", "p_lease_seconds" integer DEFAULT 900) RETURNS TABLE("acquired" boolean, "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if nullif(btrim(p_lease_name), '') is null or p_owner_id is null then
    raise exception 'invalid reminder run lease';
  end if;

  if p_lease_seconds <= 0 then
    raise exception 'reminder run lease duration must be positive';
  end if;

  insert into public.reminder_run_lease (
    lease_name,
    owner_id,
    acquired_at,
    expires_at
  )
  values (
    p_lease_name,
    p_owner_id,
    clock_timestamp(),
    clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  on conflict (lease_name) do update
    set owner_id = excluded.owner_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where public.reminder_run_lease.expires_at <= clock_timestamp()
  returning true, public.reminder_run_lease.expires_at
  into acquired, expires_at;

  if found then
    return next;
    return;
  end if;

  return query
    select false, rl.expires_at
    from public.reminder_run_lease rl
    where rl.lease_name = p_lease_name;
end;
$$;


ALTER FUNCTION "public"."acquire_reminder_run_lease"("p_lease_name" "text", "p_owner_id" "uuid", "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_session"("p_measure_id" "uuid", "p_name" "text", "p_code" "text" DEFAULT NULL::"text", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date", "p_budget" numeric DEFAULT NULL::numeric) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_new_id UUID;
BEGIN
  INSERT INTO measure_sessions (measure_id, name, code, submission_start_date, submission_end_date, total_budget, status)
  VALUES (
    p_measure_id, p_name, p_code, p_start_date, p_end_date, p_budget,
    CASE 
      WHEN p_start_date IS NULL THEN 'upcoming'
      WHEN p_start_date > CURRENT_DATE THEN 'upcoming'
      WHEN p_end_date IS NOT NULL AND p_end_date < CURRENT_DATE THEN 'closed'
      ELSE 'open'
    END
  )
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;


ALTER FUNCTION "public"."add_session"("p_measure_id" "uuid", "p_name" "text", "p_code" "text", "p_start_date" "date", "p_end_date" "date", "p_budget" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_project_phase"("p_project_id" "uuid", "p_complete_current" boolean DEFAULT true) RETURNS TABLE("previous_phase" "text", "current_phase" "text", "success" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current_phase project_phases%ROWTYPE;
  v_next_phase project_phases%ROWTYPE;
BEGIN
  SELECT * INTO v_current_phase
  FROM project_phases
  WHERE project_id = p_project_id AND status = 'in_progress'
  ORDER BY order_index LIMIT 1;
  
  IF v_current_phase.id IS NULL THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, FALSE;
    RETURN;
  END IF;
  
  SELECT * INTO v_next_phase
  FROM project_phases
  WHERE project_id = p_project_id AND order_index > v_current_phase.order_index AND status = 'pending'
  ORDER BY order_index LIMIT 1;
  
  IF p_complete_current THEN
    UPDATE project_phases 
    SET status = 'completed', completed_at = NOW(), completed_by = auth.uid() 
    WHERE id = v_current_phase.id;
  END IF;
  
  IF v_next_phase.id IS NOT NULL THEN
    UPDATE project_phases SET status = 'in_progress', started_at = NOW() WHERE id = v_next_phase.id;
    UPDATE projects SET status = v_next_phase.slug, current_phase_slug = v_next_phase.slug, updated_at = NOW() WHERE id = p_project_id;
    RETURN QUERY SELECT v_current_phase.name, v_next_phase.name, TRUE;
  ELSE
    UPDATE projects SET status = 'finalizat', current_phase_slug = NULL, lifecycle_status = 'completed', updated_at = NOW() WHERE id = p_project_id;
    RETURN QUERY SELECT v_current_phase.name, 'finalizat'::TEXT, TRUE;
  END IF;
END;
$$;


ALTER FUNCTION "public"."advance_project_phase"("p_project_id" "uuid", "p_complete_current" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_project_status"("p_project_id" "uuid") RETURNS TABLE("previous_status" "text", "new_status" "text", "success" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_current_status_id UUID;
    v_current_order INTEGER;
    v_next_status_id UUID;
    v_prev_name TEXT;
    v_new_name TEXT;
BEGIN
    -- Obținem statusul curent
    SELECT current_status_id INTO v_current_status_id
    FROM projects WHERE id = p_project_id;
    
    IF v_current_status_id IS NULL THEN
        RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, FALSE;
        RETURN;
    END IF;
    
    -- Obținem ordinea curentă și numele
    SELECT order_index, name INTO v_current_order, v_prev_name
    FROM project_statuses WHERE id = v_current_status_id;
    
    -- Găsim următorul status
    SELECT id, name INTO v_next_status_id, v_new_name
    FROM project_statuses 
    WHERE order_index > v_current_order AND is_active = true
    ORDER BY order_index 
    LIMIT 1;
    
    IF v_next_status_id IS NULL THEN
        -- Nu mai există status următor
        RETURN QUERY SELECT v_prev_name, v_prev_name, FALSE;
        RETURN;
    END IF;
    
    -- Actualizăm statusul proiectului
    UPDATE projects SET current_status_id = v_next_status_id WHERE id = p_project_id;
    
    RETURN QUERY SELECT v_prev_name, v_new_name, TRUE;
END;
$$;


ALTER FUNCTION "public"."advance_project_status"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assignment_notifications_suppressed"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(current_setting('app.skip_assignment_notifications', true), 'off') = 'on';
$$;


ALTER FUNCTION "public"."assignment_notifications_suppressed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_counts"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.audit_logs),
    'recent', (SELECT count(*) FROM public.audit_logs WHERE created_at >= now() - interval '7 days'),
    'by_action', (
      SELECT coalesce(jsonb_object_agg(t.action_type, t.n), '{}'::jsonb)
      FROM (SELECT action_type, count(*) AS n FROM public.audit_logs GROUP BY action_type) AS t
    ),
    'by_entity', (
      SELECT coalesce(jsonb_object_agg(t.entity_type, t.n), '{}'::jsonb)
      FROM (SELECT entity_type, count(*) AS n FROM public.audit_logs GROUP BY entity_type) AS t
    )
  )
$$;


ALTER FUNCTION "public"."audit_log_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_distinct_types"() RETURNS TABLE("action_type" "text", "entity_type" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT l.action_type, l.entity_type FROM public.audit_logs AS l
$$;


ALTER FUNCTION "public"."audit_log_distinct_types"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_logs_contract"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'table_exists', to_regclass('public.audit_logs') IS NOT NULL,
    'columns', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'nullable', NOT a.attnotnull
      ) ORDER BY a.attnum), '[]'::jsonb)
      FROM pg_attribute AS a
      WHERE a.attrelid = to_regclass('public.audit_logs')
        AND a.attnum > 0
        AND NOT a.attisdropped
    ),
    'indexes', (
      SELECT coalesce(jsonb_agg(i.indexname ORDER BY i.indexname), '[]'::jsonb)
      FROM pg_indexes AS i
      WHERE i.schemaname = 'public' AND i.tablename = 'audit_logs'
    ),
    'append_only_trigger', (
      SELECT jsonb_build_object(
        'row_level', (t.tgtype & 1) <> 0,
        'before', (t.tgtype & 2) <> 0,
        'on_delete', (t.tgtype & 8) <> 0,
        'on_update', (t.tgtype & 16) <> 0,
        'enabled', t.tgenabled <> 'D'
      )
      FROM pg_trigger AS t
      WHERE t.tgrelid = to_regclass('public.audit_logs')
        AND t.tgname = 'audit_logs_append_only'
        AND NOT t.tgisinternal
    )
  )
$$;


ALTER FUNCTION "public"."audit_logs_contract"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  with me as (
    select public.get_my_role() as role, auth.uid() as uid
  )
  select
    case
      when (select role from me) = 'admin' then true

      when (select role from me) = 'client' then exists (
        select 1
        from public.projects pr
        where pr.id = p_project_id
          and pr.client_id = (select uid from me)
      )

      when (select role from me) = 'consultant' then public.is_consultant_member_of_project(p_project_id)

      else false
    end;
$$;


ALTER FUNCTION "public"."can_access_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_select_notification"("p_project_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.can_select_project_chat_read(p_project_id)
    and (
      p_entity_type <> 'document_request'
      or exists (
        select 1
        from public.document_requirements dr
        where dr.id = p_entity_id
          and dr.project_id = p_project_id
          and dr.deleted_at is null
      )
    );
$$;


ALTER FUNCTION "public"."can_select_notification"("p_project_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_select_project_chat_read"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    exists (
      select 1
      from public.profiles pr
      where pr.id = auth.uid()
        and pr.role = 'admin'
    )
    or exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.client_id = auth.uid()
    )
    or exists (
      select 1
      from public.project_members pm
      where pm.project_id = p_project_id
        and pm.consultant_id = auth.uid()
    );
$$;


ALTER FUNCTION "public"."can_select_project_chat_read"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_reminder_slot"("p_entity_type" "text", "p_entity_id" "uuid", "p_project_id" "uuid", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_recipient_kind" "text", "p_threshold" "text", "p_deadline_at" timestamp with time zone, "p_source" "text", "p_triggered_by" "uuid" DEFAULT NULL::"uuid", "p_run_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("claimed" boolean, "log_id" "uuid", "send_index" integer, "claim_token" "uuid", "claim_expires_at" timestamp with time zone, "reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_send_index integer;
  v_claimed_at timestamptz;
  v_expires_at timestamptz;
  v_token uuid := gen_random_uuid();
  v_log_id uuid;
begin
  if p_source not in ('cron', 'manual')
    or p_entity_type not in ('request', 'activity')
    or p_recipient_kind not in ('client', 'consultant')
    or p_threshold not in ('1_week', '3_days', '1_day', 'same_day', 'overdue')
    or p_recipient_id is null
    or p_recipient_email is null
    or btrim(p_recipient_email) = '' then
    raise exception 'invalid reminder claim';
  end if;

  if p_source = 'cron' and p_run_id is null then
    raise exception 'cron reminder claim requires run_id';
  end if;

  if p_source = 'manual' and p_triggered_by is null then
    raise exception 'manual reminder claim requires triggered_by';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        '%s:%s:%s:%s:%s',
        p_entity_type,
        p_entity_id,
        coalesce(p_recipient_id::text, ''),
        p_threshold,
        p_deadline_at::text
      ),
      0
    )
  );

  delete from public.reminder_log as rl
  where rl.entity_type = p_entity_type
    and rl.entity_id = p_entity_id
    and rl.recipient_id is not distinct from p_recipient_id
    and rl.threshold = p_threshold
    and rl.deadline_at = p_deadline_at
    and rl.status = 'claimed'
    and rl.claim_expires_at <= clock_timestamp();

  if exists (
    select 1
    from public.reminder_log as rl
    where rl.entity_type = p_entity_type
      and rl.entity_id = p_entity_id
      and rl.recipient_id is not distinct from p_recipient_id
      and rl.threshold = p_threshold
      and rl.deadline_at = p_deadline_at
      and rl.status = 'claimed'
  ) then
    return query select false, null::uuid, null::integer, null::uuid, null::timestamptz, 'in_progress'::text;
    return;
  end if;

  if p_source = 'cron' then
    if exists (
      select 1
      from public.reminder_log as rl
      where rl.entity_type = p_entity_type
        and rl.entity_id = p_entity_id
        and rl.recipient_id is not distinct from p_recipient_id
        and rl.threshold = p_threshold
        and rl.deadline_at = p_deadline_at
        and rl.send_index = 0
    ) then
      return query select false, null::uuid, null::integer, null::uuid, null::timestamptz, 'already_consumed'::text;
      return;
    end if;
    v_send_index := 0;
  else
    select coalesce(max(rl.send_index) + 1, 0)
      into v_send_index
    from public.reminder_log as rl
    where rl.entity_type = p_entity_type
      and rl.entity_id = p_entity_id
      and rl.recipient_id is not distinct from p_recipient_id
      and rl.threshold = p_threshold
      and rl.deadline_at = p_deadline_at;
  end if;

  v_claimed_at := clock_timestamp();
  v_expires_at := v_claimed_at + interval '15 minutes';

  insert into public.reminder_log (
    entity_type,
    entity_id,
    project_id,
    recipient_id,
    recipient_email,
    recipient_kind,
    threshold,
    deadline_at,
    status,
    source,
    triggered_by,
    run_id,
    send_index,
    claim_token,
    claimed_at,
    claim_expires_at
  )
  values (
    p_entity_type,
    p_entity_id,
    p_project_id,
    p_recipient_id,
    btrim(p_recipient_email),
    p_recipient_kind,
    p_threshold,
    p_deadline_at,
    'claimed',
    p_source,
    p_triggered_by,
    p_run_id,
    v_send_index,
    v_token,
    v_claimed_at,
    v_expires_at
  )
  returning id into v_log_id;

  return query select true, v_log_id, v_send_index, v_token, v_expires_at, 'claimed'::text;
end;
$$;


ALTER FUNCTION "public"."claim_reminder_slot"("p_entity_type" "text", "p_entity_id" "uuid", "p_project_id" "uuid", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_recipient_kind" "text", "p_threshold" "text", "p_deadline_at" timestamp with time zone, "p_source" "text", "p_triggered_by" "uuid", "p_run_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_document_upload_batch"("p_requirement_id" "uuid", "p_upload_batch_id" "uuid", "p_version_number" integer, "p_uploaded_by" "uuid", "p_rows" "jsonb", "p_ip_address" "text" DEFAULT NULL::"text") RETURNS TABLE("created" boolean, "file_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  requirement_row public.document_requirements%rowtype;
  existing_count integer;
  requested_count integer;
  inserted_count integer;
  profile_email text;
  project_title text;
  file_names text;
  storage_prefix text;
begin
  if p_upload_batch_id is null
     or p_version_number is null
     or p_version_number < 1
     or coalesce(jsonb_typeof(p_rows), '') <> 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 50 then
    raise exception 'Invalid document upload batch' using errcode = 'P0001';
  end if;

  requested_count := jsonb_array_length(p_rows);

  select *
    into requirement_row
  from public.document_requirements
  where id = p_requirement_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Document request not found' using errcode = 'P0001';
  end if;

  if requirement_row.is_outgoing then
    raise exception 'Outgoing document requests do not accept uploads' using errcode = 'P0001';
  end if;

  storage_prefix := 'projects/' || requirement_row.project_id::text ||
    '/document-requests/' || p_requirement_id::text || '/v' || p_version_number::text || '/';

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where item->>'storage_path' is null
       or left(item->>'storage_path', length(storage_prefix)) <> storage_prefix
       or length(item->>'storage_path') <= length(storage_prefix)
       or left(item->>'storage_path', length(storage_prefix) + 1) = storage_prefix || '/'
       or right(item->>'storage_path', 1) = '/'
       or position('//' in substring(item->>'storage_path' from length(storage_prefix) + 1)) > 0
       or exists (
         select 1
         from regexp_split_to_table(substring(item->>'storage_path' from length(storage_prefix) + 1), '/') as segment
         where segment in ('.', '..')
       )
  ) then
    raise exception 'Upload path is outside the document request version directory' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where coalesce(item->'file_size', 'null'::jsonb) <> 'null'::jsonb
      and case
        when jsonb_typeof(item->'file_size') = 'number' then
          (item->>'file_size')::numeric < 0
          or (item->>'file_size')::numeric > 26214400
        else true
      end
  ) then
    raise exception 'File size must be between 0 and 26214400 bytes' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    group by item->>'storage_path'
    having count(*) > 1
  ) then
    raise exception 'Upload batch contains duplicate storage paths' using errcode = 'P0001';
  end if;

  select count(*)
    into existing_count
  from public.files
  where requirement_id = p_requirement_id
    and upload_batch_id = p_upload_batch_id
    and deleted_at is null;

  if existing_count > 0 then
    if existing_count <> requested_count
       or exists (
         select 1
         from public.files existing
         where existing.requirement_id = p_requirement_id
           and existing.upload_batch_id = p_upload_batch_id
           and existing.deleted_at is null
           and not exists (
             select 1
             from jsonb_array_elements(p_rows) as item
             where item->>'storage_path' = existing.storage_path
           )
       )
       or exists (
         select 1
         from jsonb_array_elements(p_rows) as item
         where not exists (
           select 1
           from public.files existing
           where existing.requirement_id = p_requirement_id
             and existing.upload_batch_id = p_upload_batch_id
             and existing.deleted_at is null
             and existing.storage_path = item->>'storage_path'
         )
       ) then
      raise exception 'Upload batch already exists with a different file set' using errcode = 'P0001';
    end if;

    return query select false, existing_count;
    return;
  end if;

  insert into public.files (
    requirement_id,
    upload_batch_id,
    storage_path,
    original_name,
    mime_type,
    file_size,
    version_number,
    uploaded_by
  )
  select
    p_requirement_id,
    p_upload_batch_id,
    item.storage_path,
    item.original_name,
    item.mime_type,
    item.file_size,
    p_version_number,
    p_uploaded_by
  from jsonb_to_recordset(p_rows) as item(
    storage_path text,
    original_name text,
    mime_type text,
    file_size bigint
  );

  get diagnostics inserted_count = row_count;
  if inserted_count <> requested_count then
    raise exception 'Document upload batch was not inserted completely' using errcode = 'P0001';
  end if;

  update public.document_requirements
  set status = 'review'
  where id = p_requirement_id
    and deleted_at is null;

  if not found then
    raise exception 'Document request disappeared during upload' using errcode = 'P0001';
  end if;

  select p.email
    into profile_email
  from public.profiles p
  where p.id = p_uploaded_by;

  select p.title
    into project_title
  from public.projects p
  where p.id = requirement_row.project_id;

  select string_agg(item->>'original_name', ', ')
    into file_names
  from jsonb_array_elements(p_rows) as item;

  insert into public.audit_logs (
    user_id,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    new_values,
    description,
    ip_address
  ) values (
    p_uploaded_by,
    'create',
    'file',
    p_requirement_id,
    requirement_row.name,
    jsonb_build_object(
      'requirement_id', p_requirement_id,
      'requirement_name', requirement_row.name,
      'project_id', requirement_row.project_id,
      'project_title', project_title,
      'file_count', requested_count,
      'version', p_version_number,
      'files', file_names,
      'upload_batch_id', p_upload_batch_id
    ),
    coalesce(profile_email, 'User') || ' a încărcat ' || requested_count ||
      ' fișier(e) pentru cererea "' || coalesce(requirement_row.name, p_requirement_id::text) ||
      '" din proiectul "' || coalesce(project_title, requirement_row.project_id::text) || '"',
    p_ip_address
  );

  return query select true, inserted_count;
end;
$$;


ALTER FUNCTION "public"."complete_document_upload_batch"("p_requirement_id" "uuid", "p_upload_batch_id" "uuid", "p_version_number" integer, "p_uploaded_by" "uuid", "p_rows" "jsonb", "p_ip_address" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_reserved_document_upload_batch"("p_upload_batch_id" "uuid", "p_actor_id" "uuid", "p_selected_file_ids" "jsonb", "p_ip_address" "text" DEFAULT NULL::"text") RETURNS TABLE("created" boolean, "version_number" integer, "file_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  batch_row public.document_upload_batches%rowtype;
  requirement_row public.document_requirements%rowtype;
  normalized_file_ids jsonb;
  requested_count integer;
  inserted_count integer;
  next_version integer;
  profile_email text;
  project_title text;
  file_names text;
  activity_assigned_to uuid;
  general_consultant_id uuid;
  responsible_id uuid;
begin
  if p_upload_batch_id is null
     or p_actor_id is null
     or coalesce(jsonb_typeof(p_selected_file_ids), '') <> 'array'
     or jsonb_array_length(p_selected_file_ids) < 1
     or jsonb_array_length(p_selected_file_ids) > 50 then
    raise exception 'Invalid document upload batch' using errcode = 'P0001';
  end if;

  requested_count := jsonb_array_length(p_selected_file_ids);

  if exists (
    select 1
    from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id)
    group by selected.file_id
    having count(*) > 1
  ) then
    raise exception 'Upload batch contains duplicate file ids' using errcode = 'P0001';
  end if;

  select *
    into batch_row
  from public.document_upload_batches
  where id = p_upload_batch_id
  for update;

  if not found then
    raise exception 'Document upload batch not found' using errcode = 'P0001';
  end if;

  if batch_row.uploaded_by <> p_actor_id then
    raise exception 'Document upload batch actor mismatch' using errcode = 'P0001';
  end if;

  select *
    into requirement_row
  from public.document_requirements
  where id = batch_row.requirement_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Document request not found' using errcode = 'P0001';
  end if;

  if requirement_row.is_outgoing then
    raise exception 'Outgoing document requests do not accept uploads' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id)
    where not exists (
      select 1
      from jsonb_array_elements(batch_row.expected_files) as expected(file_data)
      where expected.file_data->>'file_id' = selected.file_id
    )
  ) then
    raise exception 'Upload batch contains an unknown file id' using errcode = 'P0001';
  end if;

  select jsonb_agg(to_jsonb(selected.file_id) order by selected.file_id)
    into normalized_file_ids
  from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id);

  if batch_row.version_number is not null then
    if batch_row.completed_file_ids = normalized_file_ids then
      return query select false, batch_row.version_number, requested_count;
      return;
    end if;
    raise exception 'Upload batch already completed with a different file set' using errcode = 'P0001';
  end if;

  -- The requirement row lock serializes all completing batches for this request.
  select coalesce(max(f.version_number), 0) + 1
    into next_version
  from public.files as f
  where f.requirement_id = batch_row.requirement_id;

  insert into public.files (
    requirement_id,
    upload_batch_id,
    storage_path,
    original_name,
    mime_type,
    file_size,
    version_number,
    uploaded_by
  )
  select
    batch_row.requirement_id,
    batch_row.id,
    expected.file_data->>'storage_path',
    expected.file_data->>'original_name',
    nullif(expected.file_data->>'mime_type', ''),
    (expected.file_data->>'declared_size')::bigint,
    next_version,
    p_actor_id
  from jsonb_array_elements(batch_row.expected_files) as expected(file_data)
  where expected.file_data->>'file_id' in (
    select selected.file_id
    from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id)
  );

  get diagnostics inserted_count = row_count;
  if inserted_count <> requested_count then
    raise exception 'Document upload batch was not inserted completely' using errcode = 'P0001';
  end if;

  update public.document_upload_batches
  set completed_file_ids = normalized_file_ids,
      version_number = next_version,
      completed_at = now()
  where id = batch_row.id;

  update public.document_requirements
  set status = 'review'
  where id = requirement_row.id
    and deleted_at is null;

  if not found then
    raise exception 'Document request disappeared during upload' using errcode = 'P0001';
  end if;

  select p.email
    into profile_email
  from public.profiles p
  where p.id = p_actor_id;

  select p.title, p.general_consultant_id
    into project_title, general_consultant_id
  from public.projects p
  where p.id = requirement_row.project_id;

  if requirement_row.activity_id is not null then
    select a.assigned_to
      into activity_assigned_to
    from public.project_activities a
    where a.id = requirement_row.activity_id;
  end if;

  responsible_id := coalesce(requirement_row.assigned_to, activity_assigned_to, general_consultant_id);

  select string_agg(expected.file_data->>'original_name', ', ' order by expected.file_data->>'file_id')
    into file_names
  from jsonb_array_elements(batch_row.expected_files) as expected(file_data)
  where expected.file_data->>'file_id' in (
    select selected.file_id
    from jsonb_array_elements_text(p_selected_file_ids) as selected(file_id)
  );

  insert into public.audit_logs (
    user_id,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    new_values,
    description,
    ip_address
  ) values (
    p_actor_id,
    'create',
    'file',
    requirement_row.id,
    requirement_row.name,
    jsonb_build_object(
      'requirement_id', requirement_row.id,
      'requirement_name', requirement_row.name,
      'project_id', requirement_row.project_id,
      'project_title', project_title,
      'file_count', requested_count,
      'version', next_version,
      'files', file_names,
      'upload_batch_id', batch_row.id
    ),
    coalesce(profile_email, 'User') || ' a încărcat ' || requested_count ||
      ' fișier(e) pentru cererea "' || coalesce(requirement_row.name, requirement_row.id::text) ||
      '" din proiectul "' || coalesce(project_title, requirement_row.project_id::text) || '"',
    p_ip_address
  );

  perform public.insert_notification_event(
    requirement_row.project_id,
    'document_action',
    'document_request',
    requirement_row.id,
    case when requested_count = 1 then 'Document încărcat' else 'Documente încărcate' end,
    requested_count,
    'document-upload:' || batch_row.id::text,
    responsible_id,
    true,
    true,
    false,
    'info',
    (
      select coalesce(nullif(btrim(uploader.full_name), ''), uploader.email)
      from public.profiles uploader
      where uploader.id = p_actor_id
    ),
    coalesce(requirement_row.name, requirement_row.id::text)
  );

  return query select true, next_version, inserted_count;
end;
$$;


ALTER FUNCTION "public"."complete_reserved_document_upload_batch"("p_upload_batch_id" "uuid", "p_actor_id" "uuid", "p_selected_file_ids" "jsonb", "p_ip_address" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_project_phases_from_measure"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_phase_template RECORD;
  v_activity_template RECORD;
  v_new_phase_id UUID;
  v_new_activity_id UUID;
  v_doc JSONB;
  v_is_first_phase BOOLEAN := TRUE;
  v_first_phase_slug TEXT;
BEGIN
  -- Dacă nu are măsură selectată, nu creăm faze automat
  IF NEW.measure_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Parcurgem fazele măsurii
  FOR v_phase_template IN 
    SELECT * FROM measure_phase_templates 
    WHERE measure_id = NEW.measure_id AND is_active = TRUE
    ORDER BY order_index
  LOOP
    -- Creăm faza
    INSERT INTO project_phases (project_id, name, slug, description, order_index, status, started_at)
    VALUES (
      NEW.id,
      v_phase_template.name,
      v_phase_template.slug,
      v_phase_template.description,
      v_phase_template.order_index,
      CASE WHEN v_is_first_phase THEN 'in_progress' ELSE 'pending' END,
      CASE WHEN v_is_first_phase THEN NOW() ELSE NULL END
    )
    RETURNING id INTO v_new_phase_id;
    
    IF v_is_first_phase THEN
      v_first_phase_slug := v_phase_template.slug;
      v_is_first_phase := FALSE;
    END IF;
    
    -- Creăm activitățile pentru această fază
    FOR v_activity_template IN
      SELECT * FROM measure_activity_templates
      WHERE phase_template_id = v_phase_template.id AND is_active = TRUE
      ORDER BY order_index
    LOOP
      INSERT INTO project_activities (phase_id, name, description, order_index, status)
      VALUES (v_new_phase_id, v_activity_template.name, v_activity_template.description, v_activity_template.order_index, 'pending')
      RETURNING id INTO v_new_activity_id;
      
      -- Creăm cerințele de documente (tabelul există deja!)
      IF v_activity_template.required_documents IS NOT NULL AND 
         jsonb_array_length(v_activity_template.required_documents) > 0 THEN
        FOR v_doc IN SELECT * FROM jsonb_array_elements(v_activity_template.required_documents)
        LOOP
          INSERT INTO activity_document_requirements (activity_id, name, description, is_mandatory)
          VALUES (
            v_new_activity_id,
            v_doc->>'name',
            v_doc->>'description',
            COALESCE((v_doc->>'mandatory')::BOOLEAN, TRUE)
          );
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  
  -- Setăm current_phase_slug și status
  IF v_first_phase_slug IS NOT NULL THEN
    UPDATE projects 
    SET status = v_first_phase_slug,
        current_phase_slug = v_first_phase_slug
    WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_project_phases_from_measure"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_project_activity_preserving_requests"("project_id" "uuid", "phase_id" "uuid", "activity_id" "uuid") RETURNS TABLE("deleted" boolean, "moved_requests" integer, "demoted_requests" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  phase_visibility text;
  activity_visibility text;
  activity_assigned_to uuid;
  moved_count integer;
  demoted_count integer;
begin
  -- Lock the parent first so phase and activity deletion cannot deadlock.
  select p.visibility
    into phase_visibility
  from public.project_phases as p
  where p.id = $2
    and p.project_id = $1
  for update;

  if not found then
    raise exception 'Project phase not found'
      using errcode = 'P0002';
  end if;

  select a.visibility, a.assigned_to
    into activity_visibility, activity_assigned_to
  from public.project_activities as a
  where a.id = $3
    and a.phase_id = $2
  for update;

  if not found then
    raise exception 'Project activity not found'
      using errcode = 'P0002';
  end if;

  -- Lock the affected requests before counting so the returned summary matches
  -- the rows updated below, even when another write is in flight.
  perform d.id
  from public.document_requirements as d
  where d.project_id = $1
    and d.activity_id = $3
  order by d.id
  for update;

  select count(*)::integer
    into moved_count
  from public.document_requirements as d
  where d.project_id = $1
    and d.activity_id = $3
    and d.deleted_at is null;

  select count(*)::integer
    into demoted_count
  from public.document_requirements as d
  where d.project_id = $1
    and d.activity_id = $3
    and d.deleted_at is null
    and d.visibility = 'published'
    and (
      activity_visibility <> 'published'
      or phase_visibility <> 'published'
    );

  perform set_config('app.skip_assignment_notifications', 'on', true);

  update public.document_requirements as d
  set activity_id = null,
      visibility = case
        when d.visibility = 'published'
          and activity_visibility = 'published'
          and phase_visibility = 'published'
          then 'published'
        else 'draft'
      end,
      assigned_to = case
        when d.assigned_to is not null then d.assigned_to
        when activity_assigned_to is not null
          and exists (
            select 1
            from public.project_members as pm
            join public.profiles as profile on profile.id = pm.consultant_id
            where pm.project_id = $1
              and pm.consultant_id = activity_assigned_to
              and profile.role = 'consultant'
              and profile.is_active is not false
          ) then activity_assigned_to
        else null
      end
  where d.project_id = $1
    and d.activity_id = $3
    and d.deleted_at is null;

  perform set_config('app.skip_assignment_notifications', 'off', true);

  update public.document_requirements as d
  set activity_id = null
  where d.project_id = $1
    and d.activity_id = $3
    and d.deleted_at is not null;

  delete from public.project_activities as a
  where a.id = $3
    and a.phase_id = $2;

  return query
  select true, moved_count, demoted_count;
end;
$_$;


ALTER FUNCTION "public"."delete_project_activity_preserving_requests"("project_id" "uuid", "phase_id" "uuid", "activity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_project_phase_preserving_requests"("project_id" "uuid", "phase_id" "uuid") RETURNS TABLE("deleted" boolean, "deleted_activities" integer, "moved_requests" integer, "demoted_requests" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  phase_visibility text;
  deleted_activity_count integer;
  moved_count integer;
  demoted_count integer;
begin
  select p.visibility
    into phase_visibility
  from public.project_phases as p
  where p.id = $2
    and p.project_id = $1
  for update;

  if not found then
    raise exception 'Project phase not found'
      using errcode = 'P0002';
  end if;

  -- Lock children in a stable order, after locking their parent.
  perform a.id
  from public.project_activities as a
  where a.phase_id = $2
  order by a.id
  for update;

  perform d.id
  from public.document_requirements as d
  join public.project_activities as a on a.id = d.activity_id
  where d.project_id = $1
    and a.phase_id = $2
  order by d.id
  for update of d;

  select count(*)::integer
    into deleted_activity_count
  from public.project_activities as a
  where a.phase_id = $2;

  select count(*)::integer
    into moved_count
  from public.document_requirements as d
  join public.project_activities as a on a.id = d.activity_id
  where d.project_id = $1
    and a.phase_id = $2
    and d.deleted_at is null;

  select count(*)::integer
    into demoted_count
  from public.document_requirements as d
  join public.project_activities as a on a.id = d.activity_id
  where d.project_id = $1
    and a.phase_id = $2
    and d.deleted_at is null
    and d.visibility = 'published'
    and (
      a.visibility <> 'published'
      or phase_visibility <> 'published'
    );

  perform set_config('app.skip_assignment_notifications', 'on', true);

  update public.document_requirements as d
  set activity_id = null,
      visibility = case
        when d.visibility = 'published'
          and a.visibility = 'published'
          and phase_visibility = 'published'
          then 'published'
        else 'draft'
      end,
      assigned_to = case
        when d.assigned_to is not null then d.assigned_to
        when a.assigned_to is not null
          and exists (
            select 1
            from public.project_members as pm
            join public.profiles as profile on profile.id = pm.consultant_id
            where pm.project_id = $1
              and pm.consultant_id = a.assigned_to
              and profile.role = 'consultant'
              and profile.is_active is not false
          ) then a.assigned_to
        else null
      end
  from public.project_activities as a
  where d.project_id = $1
    and d.activity_id = a.id
    and a.phase_id = $2
    and d.deleted_at is null;

  perform set_config('app.skip_assignment_notifications', 'off', true);

  update public.document_requirements as d
  set activity_id = null
  from public.project_activities as a
  where d.project_id = $1
    and d.activity_id = a.id
    and a.phase_id = $2
    and d.deleted_at is not null;

  delete from public.project_activities as a
  where a.phase_id = $2;

  delete from public.project_phases as p
  where p.id = $2
    and p.project_id = $1;

  return query
  select true, deleted_activity_count, moved_count, demoted_count;
end;
$_$;


ALTER FUNCTION "public"."delete_project_phase_preserving_requests"("project_id" "uuid", "phase_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dismiss_notifications"("p_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;

  if array_length(p_ids, 1) > 500 then
    raise exception 'Too many notification ids' using errcode = 'P0001';
  end if;

  update public.notifications n
  set dismissed_at = now(),
      read_at = coalesce(n.read_at, now())
  where n.user_id = auth.uid()
    and n.dismissed_at is null
    and n.id = any (p_ids)
    and public.can_select_notification(n.project_id, n.entity_type, n.entity_id);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;


ALTER FUNCTION "public"."dismiss_notifications"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_project_chat_read_for_project_client"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.client_id is not null then
    insert into public.project_chat_reads (project_id, user_id, last_read_at)
    values (new.id, new.client_id, now())
    on conflict (project_id, user_id) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."ensure_project_chat_read_for_project_client"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_project_chat_read_for_project_member"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.consultant_id is not null then
    insert into public.project_chat_reads (project_id, user_id, last_read_at)
    values (new.project_id, new.consultant_id, now())
    on conflict (project_id, user_id) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."ensure_project_chat_read_for_project_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_reminder_claim"("p_log_id" "uuid", "p_claim_token" "uuid", "p_provider_id" "text") RETURNS TABLE("finalized" boolean, "skipped_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim public.reminder_log%rowtype;
  v_skipped integer := 0;
begin
  select *
    into v_claim
  from public.reminder_log
  where id = p_log_id
    and status = 'claimed'
    and claim_token = p_claim_token
  for update;

  if not found then
    return query select false, 0;
  end if;

  update public.reminder_log
  set status = 'sent',
      provider_id = p_provider_id,
      sent_at = clock_timestamp(),
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null
  where id = v_claim.id;

  with thresholds(threshold, urgency_rank) as (
    values
      ('1_week', 1),
      ('3_days', 2),
      ('1_day', 3),
      ('same_day', 4),
      ('overdue', 5)
  )
  insert into public.reminder_log (
    entity_type,
    entity_id,
    project_id,
    recipient_id,
    recipient_email,
    recipient_kind,
    threshold,
    deadline_at,
    status,
    source,
    triggered_by,
    run_id,
    send_index,
    skip_reason,
    created_at
  )
  select
    v_claim.entity_type,
    v_claim.entity_id,
    v_claim.project_id,
    v_claim.recipient_id,
    v_claim.recipient_email,
    v_claim.recipient_kind,
    less.threshold,
    v_claim.deadline_at,
    'skipped',
    v_claim.source,
    v_claim.triggered_by,
    v_claim.run_id,
    0,
    'threshold_consumed',
    clock_timestamp()
  from thresholds sent
  join thresholds less on less.urgency_rank < sent.urgency_rank
  where sent.threshold = v_claim.threshold
  on conflict (entity_type, entity_id, recipient_id, threshold, deadline_at, send_index)
  do nothing;

  get diagnostics v_skipped = row_count;
  return query select true, v_skipped;
end;
$$;


ALTER FUNCTION "public"."finalize_reminder_claim"("p_log_id" "uuid", "p_claim_token" "uuid", "p_provider_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_cod_intern_safe"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.cod_intern IS NULL THEN
    NEW.cod_intern := get_next_cod_intern();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_cod_intern_safe"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    SELECT role 
    FROM public.profiles 
    WHERE id = auth.uid() 
    LIMIT 1
  );
END;
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_cod_intern"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  year_part TEXT;
  seq_name TEXT;
  next_val INTEGER;
  new_code TEXT;
BEGIN
  year_part := TO_CHAR(NOW(), 'YYYY');
  seq_name := 'cod_intern_seq_' || year_part;
  
  -- Creăm sequence dacă nu există pentru anul curent
  IF NOT EXISTS (
    SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = seq_name
  ) THEN
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I START WITH 1 INCREMENT BY 1', seq_name);
  END IF;
  
  -- Obținem următoarea valoare (atomic, safe la concurență)
  EXECUTE format('SELECT nextval(%L)', seq_name) INTO next_val;
  
  new_code := 'BON-' || year_part || '-' || LPAD(next_val::TEXT, 3, '0');
  
  RETURN new_code;
END;
$$;


ALTER FUNCTION "public"."get_next_cod_intern"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_upcoming_deadlines"("p_days" integer DEFAULT 7, "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("activity_id" "uuid", "activity_name" "text", "phase_name" "text", "project_id" "uuid", "project_title" "text", "cod_intern" "text", "deadline_at" timestamp with time zone, "days_remaining" integer, "status" "text", "assigned_to" "uuid", "assigned_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.name,
    ph.name,
    pr.id,
    pr.title,
    pr.cod_intern,
    a.deadline_at,
    EXTRACT(DAY FROM a.deadline_at - NOW())::INTEGER,
    a.status,
    a.assigned_to,
    prof.full_name
  FROM project_activities a
  JOIN project_phases ph ON ph.id = a.phase_id
  JOIN projects pr ON pr.id = ph.project_id
  LEFT JOIN profiles prof ON prof.id = a.assigned_to
  WHERE a.status NOT IN ('completed', 'skipped')
    AND a.deadline_at BETWEEN NOW() AND NOW() + (p_days || ' days')::INTERVAL
    AND (p_user_id IS NULL OR a.assigned_to = p_user_id OR EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = pr.id AND pm.consultant_id = p_user_id
    ))
  ORDER BY a.deadline_at ASC;
END;
$$;


ALTER FUNCTION "public"."get_upcoming_deadlines"("p_days" integer, "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, 
    new.email, 
    new.raw_user_meta_data->>'full_name', 
    coalesce(new.raw_user_meta_data->>'role', 'client') -- Default rol = Client
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_template_to_project"("p_project_id" "uuid", "p_template_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_template_phase RECORD;
    v_template_activity RECORD;
    v_template_doc RECORD;
    v_new_phase_id UUID;
    v_new_activity_id UUID;
    v_phase_order INTEGER := 0;
BEGIN
    -- Verificăm dacă proiectul există
    IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id) THEN
        RAISE EXCEPTION 'Proiectul nu există';
    END IF;
    
    -- Verificăm dacă template-ul există
    IF NOT EXISTS (SELECT 1 FROM project_templates WHERE id = p_template_id) THEN
        RAISE EXCEPTION 'Template-ul nu există';
    END IF;
    
    -- Setăm template_id pe proiect
    UPDATE projects SET template_id = p_template_id WHERE id = p_project_id;
    
    -- Parcurgem fazele din template
    FOR v_template_phase IN 
        SELECT * FROM template_phases 
        WHERE template_id = p_template_id AND is_active = true
        ORDER BY order_index
    LOOP
        v_phase_order := v_phase_order + 1;
        
        -- Creăm faza în proiect
        INSERT INTO project_phases (
            project_id, 
            project_status_id,
            name, 
            slug, 
            description, 
            order_index, 
            status
        ) VALUES (
            p_project_id,
            v_template_phase.project_status_id,
            v_template_phase.name,
            v_template_phase.slug,
            v_template_phase.description,
            v_phase_order,
            'pending'
        ) RETURNING id INTO v_new_phase_id;
        
        -- Parcurgem activitățile din faza template
        FOR v_template_activity IN
            SELECT * FROM template_activities
            WHERE template_phase_id = v_template_phase.id AND is_active = true
            ORDER BY order_index
        LOOP
            -- Creăm activitatea în proiect
            INSERT INTO project_activities (
                phase_id,
                name,
                description,
                order_index,
                status
            ) VALUES (
                v_new_phase_id,
                v_template_activity.name,
                v_template_activity.description,
                v_template_activity.order_index,
                'pending'
            ) RETURNING id INTO v_new_activity_id;
            
            -- Parcurgem documentele cerute din template
            FOR v_template_doc IN
                SELECT * FROM template_document_requirements
                WHERE template_activity_id = v_template_activity.id
                ORDER BY order_index
            LOOP
                -- Creăm cerința de document
                INSERT INTO activity_document_requirements (
                    activity_id,
                    name,
                    description,
                    is_mandatory,
                    status
                ) VALUES (
                    v_new_activity_id,
                    v_template_doc.name,
                    v_template_doc.description,
                    v_template_doc.is_mandatory,
                    'pending'
                );
            END LOOP;
        END LOOP;
    END LOOP;
    
    -- Setăm prima fază ca "in_progress" și statusul proiectului
    UPDATE project_phases 
    SET status = 'in_progress', started_at = NOW()
    WHERE project_id = p_project_id 
    AND order_index = 1;
    
    -- Setăm statusul proiectului la primul status din template
    UPDATE projects p
    SET current_status_id = (
        SELECT project_status_id 
        FROM project_phases 
        WHERE project_id = p_project_id 
        ORDER BY order_index 
        LIMIT 1
    )
    WHERE p.id = p_project_id;
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."import_template_to_project"("p_project_id" "uuid", "p_template_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_notification_event"("p_project_id" "uuid", "p_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_title" "text", "p_item_count" integer, "p_event_key" "text", "p_recipient_id" "uuid", "p_include_admins" boolean, "p_fallback_to_project_members" boolean, "p_require_recipient" boolean, "p_severity" "text" DEFAULT 'info'::"text", "p_actor_name" "text" DEFAULT NULL::"text", "p_entity_label" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  project_client_id uuid;
  notification_event_key text;
  explicit_eligible boolean := false;
  resolved_actor_name text;
  resolved_entity_label text;
  inserted_count integer;
begin
  if p_project_id is null
     or p_entity_id is null
     or p_type not in ('publication', 'assignment', 'deadline', 'document_action')
     or p_entity_type not in ('project', 'phase', 'activity', 'document_request')
     or nullif(btrim(p_title), '') is null
     or p_item_count is null
     or p_item_count < 1
     or nullif(btrim(p_event_key), '') is null
     or coalesce(p_severity, '') not in ('info', 'success', 'warning', 'danger') then
    raise exception 'Invalid notification event' using errcode = 'P0001';
  end if;

  select p.client_id
    into project_client_id
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'Notification project not found' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.project_members pm
    join public.profiles profile on profile.id = pm.consultant_id
    where pm.project_id = p_project_id
      and pm.consultant_id = p_recipient_id
      and profile.role = 'consultant'
      and profile.is_active is not false
  ) or exists (
    select 1
    from public.profiles profile
    where profile.id = p_recipient_id
      and profile.role = 'admin'
      and profile.is_active = true
  ) or exists (
    select 1
    from public.profiles profile
    where profile.id = p_recipient_id
      and profile.role = 'client'
      and profile.is_active is not false
      and profile.id = project_client_id
  )
    into explicit_eligible;

  if p_require_recipient and not explicit_eligible then
    raise exception 'Notification recipient is not eligible for this project'
      using errcode = 'P0001';
  end if;

  notification_event_key := btrim(p_event_key);
  resolved_actor_name := nullif(btrim(p_actor_name), '');
  -- A digest points at the project, and the project title is already on the row.
  resolved_entity_label := coalesce(
    nullif(btrim(p_entity_label), ''),
    public.notification_entity_label(p_entity_type, p_entity_id)
  );

  with candidates(user_id) as (
    select pm.consultant_id
    from public.project_members pm
    join public.profiles profile on profile.id = pm.consultant_id
    where profile.role = 'consultant'
      and profile.is_active is not false
      and (
        (p_recipient_id is not null and explicit_eligible and pm.consultant_id = p_recipient_id)
        or (
          p_fallback_to_project_members
          and (p_recipient_id is null or not explicit_eligible)
        )
      )
      and pm.project_id = p_project_id
    union
    select p_recipient_id
    from public.profiles profile
    where p_recipient_id is not null
      and profile.id = p_recipient_id
      and profile.role = 'client'
      and profile.is_active is not false
      and profile.id = project_client_id
    union
    select profile.id
    from public.profiles profile
    where p_include_admins
      and profile.role = 'admin'
      and profile.is_active = true
  )
  insert into public.notifications (
    user_id,
    project_id,
    type,
    entity_type,
    entity_id,
    title,
    item_count,
    event_key,
    severity,
    actor_name,
    entity_label
  )
  select distinct
    candidates.user_id,
    p_project_id,
    p_type,
    p_entity_type,
    p_entity_id,
    btrim(p_title),
    p_item_count,
    notification_event_key,
    p_severity,
    resolved_actor_name,
    resolved_entity_label
  from candidates
  where candidates.user_id is not null
  on conflict (user_id, event_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;


ALTER FUNCTION "public"."insert_notification_event"("p_project_id" "uuid", "p_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_title" "text", "p_item_count" integer, "p_event_key" "text", "p_recipient_id" "uuid", "p_include_admins" boolean, "p_fallback_to_project_members" boolean, "p_require_recipient" boolean, "p_severity" "text", "p_actor_name" "text", "p_entity_label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_consultant_member_of_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.project_members m
    where m.project_id = p_project_id
      and m.consultant_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_consultant_member_of_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit"("p_action_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_name" "text" DEFAULT NULL::"text", "p_old_values" "jsonb" DEFAULT NULL::"jsonb", "p_new_values" "jsonb" DEFAULT NULL::"jsonb", "p_description" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, entity_name, old_values, new_values, description)
  VALUES (auth.uid(), p_action_type, p_entity_type, p_entity_id, p_entity_name, p_old_values, p_new_values, p_description)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;


ALTER FUNCTION "public"."log_audit"("p_action_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_name" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notifications_read"("p_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if p_ids is not null and coalesce(array_length(p_ids, 1), 0) > 500 then
    raise exception 'Too many notification ids' using errcode = 'P0001';
  end if;

  update public.notifications n
  set read_at = now()
  where n.user_id = auth.uid()
    and n.read_at is null
    and n.dismissed_at is null
    and (p_ids is null or n.id = any (p_ids))
    and public.can_select_notification(n.project_id, n.entity_type, n.entity_id);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;


ALTER FUNCTION "public"."mark_notifications_read"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notifications_unread"("p_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;

  if array_length(p_ids, 1) > 500 then
    raise exception 'Too many notification ids' using errcode = 'P0001';
  end if;

  update public.notifications n
  set read_at = null
  where n.user_id = auth.uid()
    and n.read_at is not null
    and n.dismissed_at is null
    and n.id = any (p_ids)
    and public.can_select_notification(n.project_id, n.entity_type, n.entity_id);

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;


ALTER FUNCTION "public"."mark_notifications_unread"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_project_chat_author_read"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into public.project_chat_reads (project_id, user_id, last_read_at)
  values (new.project_id, new.created_by, new.created_at)
  on conflict (project_id, user_id) do update
    set last_read_at = greatest(
      coalesce(public.project_chat_reads.last_read_at, '-infinity'::timestamptz),
      excluded.last_read_at
    )
    where public.project_chat_reads.last_read_at is null
       or public.project_chat_reads.last_read_at < excluded.last_read_at;

  return new;
end;
$$;


ALTER FUNCTION "public"."mark_project_chat_author_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notification_entity_label"("p_entity_type" "text", "p_entity_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case p_entity_type
    when 'activity' then (
      select nullif(btrim(a.name), '') from public.project_activities a where a.id = p_entity_id
    )
    when 'phase' then (
      select nullif(btrim(ph.name), '') from public.project_phases ph where ph.id = p_entity_id
    )
    when 'document_request' then (
      select nullif(btrim(dr.name), '') from public.document_requirements dr where dr.id = p_entity_id
    )
    else null
  end;
$$;


ALTER FUNCTION "public"."notification_entity_label"("p_entity_type" "text", "p_entity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notification_unread_summary"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('projectId', totals.project_id, 'count', totals.unread_count)
      order by totals.project_id
    ),
    '[]'::jsonb
  )
  from (
    select n.project_id, count(*)::bigint as unread_count
    from public.notifications n
    where n.user_id = auth.uid()
      and n.read_at is null
      and n.dismissed_at is null
      and public.can_select_notification(n.project_id, n.entity_type, n.entity_id)
    group by n.project_id
  ) totals;
$$;


ALTER FUNCTION "public"."notification_unread_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_document_request_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if public.assignment_notifications_suppressed() then
    return new;
  end if;

  perform public.insert_notification_event(
    new.project_id,
    'assignment',
    'document_request',
    new.id,
    'Cerere de document atribuită',
    1,
    format(
      'assignment-v2:%s:%s:%s:%s:%s',
      new.project_id,
      new.id,
      new.assigned_to,
      coalesce(old.assigned_to::text, 'none'),
      txid_current()
    ),
    new.assigned_to,
    true,
    false,
    true,
    'info',
    (
      select coalesce(nullif(btrim(actor.full_name), ''), actor.email)
      from public.profiles actor
      where actor.id = new.assigned_by
    ),
    coalesce(new.name, new.id::text)
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_document_request_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_project_activity_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  project_id uuid;
begin
  if public.assignment_notifications_suppressed() then
    return new;
  end if;

  select p.project_id
    into project_id
  from public.project_phases p
  where p.id = new.phase_id;

  if not found then
    raise exception 'Project phase not found' using errcode = 'P0001';
  end if;

  perform public.insert_notification_event(
    project_id,
    'assignment',
    'activity',
    new.id,
    'Activitate atribuită',
    1,
    format(
      'assignment-v2:%s:%s:%s:%s:%s',
      project_id,
      new.id,
      new.assigned_to,
      coalesce(old.assigned_to::text, 'none'),
      txid_current()
    ),
    new.assigned_to,
    true,
    false,
    true,
    'info',
    (
      select coalesce(nullif(btrim(actor.full_name), ''), actor.email)
      from public.profiles actor
      where actor.id = new.assigned_by
    ),
    coalesce(new.name, new.id::text)
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_project_activity_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_audit_logs_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION
    'public.audit_logs is append-only; % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;


ALTER FUNCTION "public"."prevent_audit_logs_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_chat_messages_emit_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  next_event_type text;
begin
  if tg_op = 'INSERT' then
    next_event_type := case when new.deleted_at is null then 'created' else 'deleted' end;
  elsif old.deleted_at is null and new.deleted_at is not null then
    next_event_type := 'deleted';
  else
    next_event_type := 'updated';
  end if;

  insert into public.project_chat_events (message_id, project_id, event_type, changed_at)
  values (new.id, new.project_id, next_event_type, now())
  on conflict (message_id) do update
    set project_id = excluded.project_id,
        event_type = excluded.event_type,
        changed_at = excluded.changed_at;

  return new;
end;
$$;


ALTER FUNCTION "public"."project_chat_messages_emit_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_reminder_claim"("p_log_id" "uuid", "p_claim_token" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted integer;
begin
  delete from public.reminder_log
  where id = p_log_id
    and status = 'claimed'
    and claim_token = p_claim_token;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;


ALTER FUNCTION "public"."release_reminder_claim"("p_log_id" "uuid", "p_claim_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_reminder_run_lease"("p_lease_name" "text", "p_owner_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted integer;
begin
  delete from public.reminder_run_lease
  where lease_name = p_lease_name
    and owner_id = p_owner_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;


ALTER FUNCTION "public"."release_reminder_run_lease"("p_lease_name" "text", "p_owner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_project_member_if_unassigned"("p_project_id" "uuid", "p_member_id" "uuid") RETURNS TABLE("removed" boolean, "consultant_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  project_general_consultant_id uuid;
  member_consultant_id uuid;
begin
  -- Lock the project first, then the membership and all assignment rows. This
  -- gives assignment updates a stable serialization point with this delete.
  select p.general_consultant_id
    into project_general_consultant_id
  from public.projects as p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  select pm.consultant_id
    into member_consultant_id
  from public.project_members as pm
  where pm.id = p_member_id
    and pm.project_id = p_project_id
  for update;

  if not found then
    raise exception 'Project member not found'
      using errcode = 'P0002';
  end if;

  perform a.id
  from public.project_activities as a
  join public.project_phases as ph on ph.id = a.phase_id
  where ph.project_id = p_project_id
  order by a.id
  for update;

  perform d.id
  from public.document_requirements as d
  where d.project_id = p_project_id
    and d.deleted_at is null
  order by d.id
  for update;

  if project_general_consultant_id = member_consultant_id then
    raise exception 'Cannot remove this consultant while they are the project general consultant. Reassign the project first.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.project_activities as a
    join public.project_phases as ph on ph.id = a.phase_id
    where ph.project_id = p_project_id
      and a.assigned_to = member_consultant_id
  ) then
    raise exception 'Cannot remove this consultant while they are assigned to an activity. Reassign the activity first.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.document_requirements as d
    where d.project_id = p_project_id
      and d.deleted_at is null
      and d.assigned_to = member_consultant_id
  ) then
    raise exception 'Cannot remove this consultant while they are assigned to an active document request. Reassign the request first.'
      using errcode = 'P0001';
  end if;

  delete from public.project_members as pm
  where pm.id = p_member_id
    and pm.project_id = p_project_id;

  if not found then
    raise exception 'Project member not found'
      using errcode = 'P0002';
  end if;

  return query select true, member_consultant_id;
end;
$$;


ALTER FUNCTION "public"."remove_project_member_if_unassigned"("p_project_id" "uuid", "p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_project_phase"("p_project_id" "uuid", "p_target_phase_slug" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_target_phase project_phases%ROWTYPE;
BEGIN
  SELECT * INTO v_target_phase
  FROM project_phases
  WHERE project_id = p_project_id AND slug = p_target_phase_slug;
  
  IF v_target_phase.id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  UPDATE project_phases
  SET status = 'pending', started_at = NULL, completed_at = NULL, completed_by = NULL
  WHERE project_id = p_project_id AND order_index > v_target_phase.order_index;
  
  UPDATE project_phases
  SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), completed_at = NULL, completed_by = NULL
  WHERE id = v_target_phase.id;
  
  UPDATE projects 
  SET status = p_target_phase_slug, current_phase_slug = p_target_phase_slug, lifecycle_status = 'active', updated_at = NOW() 
  WHERE id = p_project_id;
  
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."revert_project_phase"("p_project_id" "uuid", "p_target_phase_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_document_request"("p_request_id" "uuid", "p_action" "text", "p_reason" "text" DEFAULT NULL::"text", "p_reviewed_by" "uuid" DEFAULT NULL::"uuid", "p_ip_address" "text" DEFAULT NULL::"text") RETURNS TABLE("created" boolean, "review_id" "uuid", "reviewed_version_number" integer, "action" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  requirement_row public.document_requirements%rowtype;
  latest_version integer;
  existing_review public.document_request_reviews%rowtype;
  inserted_review public.document_request_reviews%rowtype;
  profile_email text;
  activity_visibility text;
  activity_phase_id uuid;
  phase_visibility text;
  project_client_id uuid;
  client_visible boolean;
begin
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid review action' using errcode = 'P0001';
  end if;

  select *
    into requirement_row
  from public.document_requirements
  where id = p_request_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Document request not found' using errcode = 'P0001';
  end if;

  if requirement_row.is_outgoing then
    raise exception 'Outgoing document requests do not enter review' using errcode = 'P0001';
  end if;

  select f.version_number
    into latest_version
  from public.files f
  where f.requirement_id = p_request_id
    and f.deleted_at is null
  order by f.version_number desc, f.created_at desc, f.id desc
  limit 1;

  if latest_version is null then
    raise exception 'No uploaded files to review' using errcode = 'P0001';
  end if;

  if p_action = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'Notes are required for rejection' using errcode = 'P0001';
  end if;

  select *
    into existing_review
  from public.document_request_reviews r
  where r.requirement_id = p_request_id
    and r.reviewed_version_number = latest_version
  order by r.reviewed_at desc, r.id desc
  limit 1;

  if found then
    if existing_review.action <> p_action then
      raise exception 'This document version was already reviewed with another action' using errcode = 'P0001';
    end if;
    return query select false, existing_review.id, existing_review.reviewed_version_number, existing_review.action;
    return;
  end if;

  if requirement_row.status <> 'review' then
    raise exception 'Document request is not ready for review' using errcode = 'P0001';
  end if;

  insert into public.document_request_reviews (
    requirement_id,
    action,
    reason,
    reviewed_version_number,
    reviewed_by
  ) values (
    p_request_id,
    p_action,
    case when p_action = 'rejected' then nullif(btrim(p_reason), '') else null end,
    latest_version,
    p_reviewed_by
  )
  returning * into inserted_review;

  update public.document_requirements
  set status = p_action
  where id = p_request_id
    and deleted_at is null;

  if not found then
    raise exception 'Document request disappeared during review' using errcode = 'P0001';
  end if;

  select p.email
    into profile_email
  from public.profiles p
  where p.id = p_reviewed_by;

  insert into public.audit_logs (
    user_id,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    old_values,
    new_values,
    description,
    ip_address
  ) values (
    p_reviewed_by,
    'update',
    'document',
    p_request_id,
    coalesce(requirement_row.name, 'Document'),
    jsonb_build_object('status', requirement_row.status),
    jsonb_build_object(
      'status', p_action,
      'reviewed_version_number', latest_version,
      'reason', case when p_action = 'rejected' then nullif(btrim(p_reason), '') else null end
    ),
    coalesce(profile_email, 'User') || ' a ' ||
      case when p_action = 'approved' then 'aprobat' else 'respins' end ||
      ' documentul "' || coalesce(requirement_row.name, p_request_id::text) || '"' ||
      case when p_action = 'rejected' and nullif(btrim(p_reason), '') is not null
        then ' cu motivul: ' || btrim(p_reason)
        else '' end,
    p_ip_address
  );

  select p.client_id
    into project_client_id
  from public.projects p
  where p.id = requirement_row.project_id;

  client_visible := requirement_row.visibility = 'published';
  if client_visible and requirement_row.activity_id is not null then
    select a.visibility, a.phase_id, p.visibility
      into activity_visibility, activity_phase_id, phase_visibility
    from public.project_activities a
    left join public.project_phases p on p.id = a.phase_id
    where a.id = requirement_row.activity_id
      and (a.phase_id is null or p.project_id = requirement_row.project_id);

    client_visible := found
      and activity_visibility = 'published'
      and (activity_phase_id is null or phase_visibility = 'published');
  end if;

  perform public.insert_notification_event(
    requirement_row.project_id,
    'document_action',
    'document_request',
    p_request_id,
    'Document ' || case when p_action = 'approved' then 'aprobat' else 'respins' end,
    1,
    'document-review:' || inserted_review.id::text,
    case when client_visible then project_client_id else null end,
    true,
    false,
    false,
    case when p_action = 'approved' then 'success' else 'danger' end,
    (
      select coalesce(nullif(btrim(reviewer.full_name), ''), reviewer.email)
      from public.profiles reviewer
      where reviewer.id = p_reviewed_by
    ),
    coalesce(requirement_row.name, p_request_id::text)
  );

  return query select true, inserted_review.id, inserted_review.reviewed_version_number, inserted_review.action;
end;
$$;


ALTER FUNCTION "public"."review_document_request"("p_request_id" "uuid", "p_action" "text", "p_reason" "text", "p_reviewed_by" "uuid", "p_ip_address" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_project_chat_reads_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_project_chat_reads_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shift_project_activities_after_duplicate"("p_phase_id" "uuid", "p_source_activity_id" "uuid", "p_copy_activity_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  source_order integer;
begin
  if p_source_activity_id = p_copy_activity_id then
    raise exception 'Sursa și copia activității trebuie să fie diferite';
  end if;

  select coalesce(order_index, 0)
    into source_order
  from public.project_activities
  where id = p_source_activity_id
    and phase_id = p_phase_id;

  if not found then
    raise exception 'Activitatea sursă nu aparține fazei';
  end if;

  if not exists (
    select 1
    from public.project_activities
    where id = p_copy_activity_id
      and phase_id = p_phase_id
  ) then
    raise exception 'Copia activității nu aparține fazei';
  end if;

  update public.project_activities
  set order_index = order_index + 1
  where phase_id = p_phase_id
    and order_index > source_order
    and id <> p_copy_activity_id;
end;
$$;


ALTER FUNCTION "public"."shift_project_activities_after_duplicate"("p_phase_id" "uuid", "p_source_activity_id" "uuid", "p_copy_activity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shift_project_phases_after_duplicate"("p_project_id" "uuid", "p_source_phase_id" "uuid", "p_copy_phase_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  source_order integer;
begin
  if p_source_phase_id = p_copy_phase_id then
    raise exception 'Sursa și copia fazei trebuie să fie diferite';
  end if;

  select coalesce(order_index, 0)
    into source_order
  from public.project_phases
  where id = p_source_phase_id
    and project_id = p_project_id;

  if not found then
    raise exception 'Faza sursă nu aparține proiectului';
  end if;

  if not exists (
    select 1
    from public.project_phases
    where id = p_copy_phase_id
      and project_id = p_project_id
  ) then
    raise exception 'Copia fazei nu aparține proiectului';
  end if;

  update public.project_phases
  set order_index = order_index + 1
  where project_id = p_project_id
    and order_index > source_order
    and id <> p_copy_phase_id;
end;
$$;


ALTER FUNCTION "public"."shift_project_phases_after_duplicate"("p_project_id" "uuid", "p_source_phase_id" "uuid", "p_copy_phase_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_requirement_type"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'INSERT' then
    if new.requirement_type is not null then
      new.is_mandatory := (new.requirement_type = 'obligatoriu');
    else
      new.requirement_type := case when new.is_mandatory then 'obligatoriu' else 'optional' end;
    end if;
  else -- UPDATE
    if new.requirement_type is distinct from old.requirement_type then
      new.is_mandatory := (new.requirement_type = 'obligatoriu');
    elsif new.is_mandatory is distinct from old.is_mandatory then
      new.requirement_type := case when new.is_mandatory then 'obligatoriu' else 'optional' end;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_requirement_type"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_requirement_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE activity_document_requirements
    SET status = 'review', updated_at = NOW()
    WHERE id = NEW.requirement_id AND status IN ('pending', 'rejected');
    
  ELSIF TG_OP = 'UPDATE' AND NEW.review_status IS DISTINCT FROM OLD.review_status THEN
    IF NEW.review_status = 'approved' THEN
      UPDATE activity_document_requirements
      SET status = 'approved', updated_at = NOW()
      WHERE id = NEW.requirement_id;
    ELSIF NEW.review_status = 'rejected' THEN
      UPDATE activity_document_requirements
      SET status = 'rejected', updated_at = NOW()
      WHERE id = NEW.requirement_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_requirement_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_document_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requirement_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "original_name" "text" NOT NULL,
    "file_size" integer,
    "mime_type" "text",
    "version_number" integer DEFAULT 1 NOT NULL,
    "review_status" "text" DEFAULT 'pending'::"text",
    "review_notes" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "uploaded_by" "uuid",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "activity_document_files_review_status_check" CHECK (("review_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."activity_document_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_document_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_mandatory" boolean DEFAULT true,
    "template_path" "text",
    "template_name" "text",
    "deadline_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "activity_document_requirements_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'uploaded'::"text", 'review'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."activity_document_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phase_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "order_index" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "assigned_to" "uuid",
    "deadline_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "source_template_activity_id" "uuid",
    "visibility" "text" DEFAULT 'draft'::"text" NOT NULL,
    "client_notified_at" timestamp with time zone,
    "assigned_by" "uuid",
    CONSTRAINT "project_activities_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'skipped'::"text", 'blocked'::"text"]))),
    CONSTRAINT "project_activities_visibility_check" CHECK (("visibility" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."project_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_phases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "order_index" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "project_status_id" "uuid",
    "source_template_phase_id" "uuid",
    "visibility" "text" DEFAULT 'draft'::"text" NOT NULL,
    "client_notified_at" timestamp with time zone,
    CONSTRAINT "project_phases_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'skipped'::"text"]))),
    CONSTRAINT "project_phases_visibility_check" CHECK (("visibility" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."project_phases" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."activity_documents_status" AS
 SELECT "a"."id" AS "activity_id",
    "a"."name" AS "activity_name",
    "a"."status" AS "activity_status",
    "ph"."id" AS "phase_id",
    "ph"."name" AS "phase_name",
    "ph"."project_id",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE ("activity_document_requirements"."activity_id" = "a"."id")) AS "total_required",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."is_mandatory" = true))) AS "mandatory_required",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."status" = 'approved'::"text"))) AS "approved_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."status" = 'pending'::"text"))) AS "pending_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."status" = 'review'::"text"))) AS "review_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."status" = 'rejected'::"text"))) AS "rejected_count",
        CASE
            WHEN (( SELECT "count"(*) AS "count"
               FROM "public"."activity_document_requirements"
              WHERE ("activity_document_requirements"."activity_id" = "a"."id")) = 0) THEN (100)::numeric
            ELSE "round"((((( SELECT "count"(*) AS "count"
               FROM "public"."activity_document_requirements"
              WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."status" = 'approved'::"text"))))::numeric / (( SELECT "count"(*) AS "count"
               FROM "public"."activity_document_requirements"
              WHERE ("activity_document_requirements"."activity_id" = "a"."id")))::numeric) * (100)::numeric), 0)
        END AS "document_progress_percent",
    ( SELECT (("count"(*) = 0) OR ("count"(*) = "sum"(
                CASE
                    WHEN ("activity_document_requirements"."status" = 'approved'::"text") THEN 1
                    ELSE 0
                END)))
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."is_mandatory" = true))) AS "all_mandatory_approved"
   FROM ("public"."project_activities" "a"
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "a"."phase_id")));


ALTER VIEW "public"."activity_documents_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "entity_name" "text",
    "old_values" "jsonb",
    "new_values" "jsonb",
    "description" "text",
    "ip_address" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cod_intern_seq_2026"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


-- Local dev: nu schimbăm ownership pe secvență (migration runner-ul local
-- nu are voie să reasigneze owner către service_role); GRANT-urile de mai
-- jos sunt suficiente pentru funcționare.


CREATE TABLE IF NOT EXISTS "public"."document_request_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requirement_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "reason" "text",
    "reviewed_version_number" integer NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_notified_at" timestamp with time zone,
    CONSTRAINT "document_request_reviews_action_check" CHECK (("action" = ANY (ARRAY['approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "document_request_reviews_approved_reason_chk" CHECK ((("action" <> 'approved'::"text") OR ("reason" IS NULL))),
    CONSTRAINT "document_request_reviews_rejected_reason_chk" CHECK ((("action" <> 'rejected'::"text") OR (NULLIF("btrim"("reason"), ''::"text") IS NOT NULL)))
);


ALTER TABLE "public"."document_request_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_requirement_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_requirement_id" "uuid",
    "template_document_requirement_id" "uuid",
    "source_template_attachment_id" "uuid",
    "storage_path" "text" NOT NULL,
    "original_name" "text",
    "mime_type" "text",
    "file_size" bigint,
    "order_index" integer DEFAULT 0 NOT NULL,
    "missing_at" timestamp with time zone,
    "missing_checked_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_requirement_attachments_file_size_chk" CHECK ((("file_size" IS NULL) OR ("file_size" >= 0))),
    CONSTRAINT "document_requirement_attachments_one_owner_chk" CHECK ((((("document_requirement_id" IS NOT NULL))::integer + (("template_document_requirement_id" IS NOT NULL))::integer) = 1))
);


ALTER TABLE "public"."document_requirement_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_requirements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "assigned_to" "uuid",
    "deadline_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text",
    "is_locked" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "attachment_path" "text",
    "created_by" "uuid",
    "activity_id" "uuid",
    "is_mandatory" boolean DEFAULT false,
    "reminder_sent_at" timestamp with time zone,
    "reminder_type_sent" "text",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "attachment_missing_at" timestamp with time zone,
    "attachment_missing_checked_at" timestamp with time zone,
    "delete_reason" "text",
    "source_template_document_requirement_id" "uuid",
    "attachment_original_name" "text",
    "requirement_type" "text" NOT NULL,
    "is_outgoing" boolean DEFAULT false NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "visibility" "text" DEFAULT 'draft'::"text" NOT NULL,
    "client_notified_at" timestamp with time zone,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone,
    CONSTRAINT "document_requirements_requirement_type_check" CHECK (("requirement_type" = ANY (ARRAY['obligatoriu'::"text", 'daca_e_cazul'::"text", 'optional'::"text"]))),
    CONSTRAINT "document_requirements_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'review'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "document_requirements_visibility_check" CHECK (("visibility" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."document_requirements" OWNER TO "postgres";


COMMENT ON COLUMN "public"."document_requirements"."assigned_at" IS 'Momentul ultimei schimbări de `assigned_to`. Versiunea din cheia de idempotență a emailului de atribuire.';



CREATE TABLE IF NOT EXISTS "public"."document_upload_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requirement_id" "uuid" NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "expected_files" "jsonb" NOT NULL,
    "completed_file_ids" "jsonb",
    "version_number" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "document_upload_batches_completed_file_ids_check" CHECK ((("completed_file_ids" IS NULL) OR ("jsonb_typeof"("completed_file_ids") = 'array'::"text"))),
    CONSTRAINT "document_upload_batches_expected_files_check" CHECK ((("jsonb_typeof"("expected_files") = 'array'::"text") AND (("jsonb_array_length"("expected_files") >= 1) AND ("jsonb_array_length"("expected_files") <= 50)))),
    CONSTRAINT "document_upload_batches_version_check" CHECK ((("version_number" IS NULL) OR ("version_number" > 0)))
);


ALTER TABLE "public"."document_upload_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "requirement_id" "uuid",
    "storage_path" "text" NOT NULL,
    "version_number" integer DEFAULT 1,
    "uploaded_by" "uuid",
    "comments" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "original_name" "text" NOT NULL,
    "mime_type" "text",
    "file_size" bigint,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "upload_batch_id" "uuid"
);


ALTER TABLE "public"."files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."measure_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "measure_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text",
    "description" "text",
    "submission_start_date" "date",
    "submission_end_date" "date",
    "total_budget" numeric(15,2),
    "remaining_budget" numeric(15,2),
    "status" "text" DEFAULT 'upcoming'::"text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "measure_sessions_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'open'::"text", 'closed'::"text", 'evaluation'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."measure_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_measures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "code" "text",
    "description" "text",
    "max_funding_amount" numeric(15,2),
    "min_funding_amount" numeric(15,2),
    "co_financing_percent" numeric(5,2) DEFAULT 0,
    "currency" "text" DEFAULT 'EUR'::"text",
    "eligible_applicants" "text",
    "eligible_regions" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."program_measures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "official_url" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."programs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."funding_hierarchy" AS
 SELECT "p"."id" AS "program_id",
    "p"."name" AS "program_name",
    "p"."slug" AS "program_slug",
    "pm"."id" AS "measure_id",
    "pm"."name" AS "measure_name",
    "pm"."slug" AS "measure_slug",
    "pm"."code" AS "measure_code",
    "pm"."max_funding_amount",
    "pm"."co_financing_percent",
    "ms"."id" AS "session_id",
    "ms"."name" AS "session_name",
    "ms"."code" AS "session_code",
    "ms"."status" AS "session_status",
    "ms"."submission_start_date",
    "ms"."submission_end_date"
   FROM (("public"."programs" "p"
     LEFT JOIN "public"."program_measures" "pm" ON ((("pm"."program_id" = "p"."id") AND ("pm"."is_active" = true))))
     LEFT JOIN "public"."measure_sessions" "ms" ON ((("ms"."measure_id" = "pm"."id") AND ("ms"."is_active" = true))))
  WHERE ("p"."is_active" = true)
  ORDER BY "p"."name", "pm"."name", "ms"."submission_start_date" DESC;


ALTER VIEW "public"."funding_hierarchy" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."measure_activity_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phase_template_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "order_index" integer NOT NULL,
    "estimated_days" integer,
    "required_documents" "jsonb" DEFAULT '[]'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."measure_activity_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."measure_phase_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "measure_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "order_index" integer NOT NULL,
    "estimated_days" integer,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."measure_phase_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text" NOT NULL,
    "client_id" "uuid",
    "status" "text" DEFAULT 'contractare'::"text",
    "progress" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "program_id" "uuid",
    "measure_id" "uuid",
    "session_id" "uuid",
    "cod_proiect" "text",
    "cod_intern" "text",
    "telefon_contact" "text",
    "email_contact" "text",
    "persoana_contact" "text",
    "is_preluat" boolean DEFAULT false,
    "preluat_detalii" "text",
    "current_phase_slug" "text",
    "lifecycle_status" "text" DEFAULT 'active'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "current_status_id" "uuid",
    "template_id" "uuid",
    "general_consultant_id" "uuid",
    "automatic_reminders_enabled" boolean DEFAULT true NOT NULL,
    CONSTRAINT "projects_lifecycle_status_check" CHECK (("lifecycle_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'completed'::"text", 'cancelled'::"text", 'archived'::"text"]))),
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['contractare'::"text", 'implementare'::"text", 'monitorizare'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."projects"."status" IS 'Status general vizibil (slug-ul fazei curente sau stare business)';



COMMENT ON COLUMN "public"."projects"."current_phase_slug" IS 'Slug-ul fazei curente (pentru tracking intern)';



COMMENT ON COLUMN "public"."projects"."lifecycle_status" IS 'Starea ciclului de viață: active, suspended, completed, cancelled, archived';



COMMENT ON COLUMN "public"."projects"."automatic_reminders_enabled" IS 'Controls automatic deadline reminder emails sent to project clients and consultants.';



CREATE OR REPLACE VIEW "public"."measures_overview" AS
 SELECT "pm"."id",
    "pm"."program_id",
    "pm"."name",
    "pm"."slug",
    "pm"."code",
    "pm"."description",
    "pm"."max_funding_amount",
    "pm"."min_funding_amount",
    "pm"."co_financing_percent",
    "pm"."currency",
    "pm"."eligible_applicants",
    "pm"."eligible_regions",
    "pm"."is_active",
    "pm"."created_at",
    "pm"."updated_at",
    "p"."name" AS "program_name",
    "p"."slug" AS "program_slug",
    ( SELECT "count"(*) AS "count"
           FROM "public"."measure_sessions"
          WHERE (("measure_sessions"."measure_id" = "pm"."id") AND ("measure_sessions"."is_active" = true))) AS "total_sessions",
    ( SELECT "count"(*) AS "count"
           FROM "public"."measure_sessions"
          WHERE (("measure_sessions"."measure_id" = "pm"."id") AND ("measure_sessions"."status" = 'open'::"text"))) AS "open_sessions",
    ( SELECT "count"(*) AS "count"
           FROM "public"."projects"
          WHERE ("projects"."measure_id" = "pm"."id")) AS "total_projects"
   FROM ("public"."program_measures" "pm"
     JOIN "public"."programs" "p" ON (("p"."id" = "pm"."program_id")))
  WHERE ("pm"."is_active" = true)
  ORDER BY "p"."name", "pm"."name";


ALTER VIEW "public"."measures_overview" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "item_count" integer DEFAULT 1 NOT NULL,
    "event_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "dismissed_at" timestamp with time zone,
    "actor_name" "text",
    "entity_label" "text",
    CONSTRAINT "notifications_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['project'::"text", 'phase'::"text", 'activity'::"text", 'document_request'::"text"]))),
    CONSTRAINT "notifications_item_count_check" CHECK (("item_count" > 0)),
    CONSTRAINT "notifications_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'success'::"text", 'warning'::"text", 'danger'::"text"]))),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['publication'::"text", 'assignment'::"text", 'deadline'::"text", 'document_action'::"text"])))
);

ALTER TABLE ONLY "public"."notifications" REPLICA IDENTITY FULL;


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_conversation_participants" (
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_at" timestamp with time zone
);


ALTER TABLE "public"."private_conversation_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "last_message_at" timestamp with time zone
);


ALTER TABLE "public"."private_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."private_messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."private_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "role" "text" DEFAULT 'client'::"text",
    "phone_number" "text",
    "cif" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "nume_firma" "text",
    "adresa_firma" "text",
    "telefon" "text",
    "persoana_contact" "text",
    "departament" "text",
    "specializare" "text",
    "is_active" boolean DEFAULT true,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "password_reset_requested_at" timestamp with time zone,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'consultant'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."cif" IS 'Cod de Identificare Fiscală (fost CUI)';



COMMENT ON COLUMN "public"."profiles"."persoana_contact" IS 'Vizibil doar pentru admin';



COMMENT ON COLUMN "public"."profiles"."is_active" IS 'Soft delete - false înseamnă dezactivat';



COMMENT ON COLUMN "public"."profiles"."password_reset_requested_at" IS 'Ultima solicitare publică de resetare a parolei; folosită pentru cooldown-ul de 15 minute.';



CREATE OR REPLACE VIEW "public"."programs_overview" AS
 SELECT "id",
    "name",
    "slug",
    "description",
    "official_url",
    "is_active",
    "created_at",
    "updated_at",
    ( SELECT "count"(*) AS "count"
           FROM "public"."program_measures"
          WHERE (("program_measures"."program_id" = "p"."id") AND ("program_measures"."is_active" = true))) AS "total_measures",
    ( SELECT "count"(*) AS "count"
           FROM "public"."projects"
          WHERE ("projects"."program_id" = "p"."id")) AS "total_projects"
   FROM "public"."programs" "p"
  WHERE ("is_active" = true)
  ORDER BY "name";


ALTER VIEW "public"."programs_overview" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."project_activities_complete" AS
 SELECT "a"."id" AS "activity_id",
    "a"."phase_id",
    "a"."name" AS "activity_name",
    "a"."description" AS "activity_description",
    "a"."order_index" AS "activity_order",
    "a"."status" AS "activity_status",
    "a"."assigned_to",
    "a"."deadline_at" AS "activity_deadline",
    "a"."notes" AS "activity_notes",
    "ph"."name" AS "phase_name",
    "ph"."slug" AS "phase_slug",
    "ph"."project_id",
    "pr"."title" AS "project_title",
    "pr"."cod_intern",
    "prof"."full_name" AS "assigned_name",
    "prof"."email" AS "assigned_email",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE ("activity_document_requirements"."activity_id" = "a"."id")) AS "total_documents",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."status" = 'approved'::"text"))) AS "approved_documents",
    ( SELECT "count"(*) AS "count"
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."status" = 'pending'::"text"))) AS "pending_documents",
    ( SELECT (("count"(*) = 0) OR ("count"(*) = "sum"(
                CASE
                    WHEN ("activity_document_requirements"."status" = 'approved'::"text") THEN 1
                    ELSE 0
                END)))
           FROM "public"."activity_document_requirements"
          WHERE (("activity_document_requirements"."activity_id" = "a"."id") AND ("activity_document_requirements"."is_mandatory" = true))) AS "can_complete"
   FROM ((("public"."project_activities" "a"
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "a"."phase_id")))
     JOIN "public"."projects" "pr" ON (("pr"."id" = "ph"."project_id")))
     LEFT JOIN "public"."profiles" "prof" ON (("prof"."id" = "a"."assigned_to")))
  ORDER BY "ph"."project_id", "ph"."order_index", "a"."order_index";


ALTER VIEW "public"."project_activities_complete" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_chat_events" (
    "message_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_chat_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['created'::"text", 'updated'::"text", 'deleted'::"text"])))
);

ALTER TABLE ONLY "public"."project_chat_events" REPLICA IDENTITY FULL;


ALTER TABLE "public"."project_chat_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "body" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "images" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "project_chat_messages_body_check" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 5000))),
    CONSTRAINT "project_chat_messages_body_or_images" CHECK (((NULLIF("btrim"("body"), ''::"text") IS NOT NULL) OR (("jsonb_typeof"("images") = 'array'::"text") AND ("jsonb_array_length"(
CASE
    WHEN ("jsonb_typeof"("images") = 'array'::"text") THEN "images"
    ELSE '[]'::"jsonb"
END) > 0)))),
    CONSTRAINT "project_chat_messages_images_array_max" CHECK ((("jsonb_typeof"("images") = 'array'::"text") AND ("jsonb_array_length"(
CASE
    WHEN ("jsonb_typeof"("images") = 'array'::"text") THEN "images"
    ELSE '[]'::"jsonb"
END) <= 5)))
);

ALTER TABLE ONLY "public"."project_chat_messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."project_chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_chat_reads" (
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."project_chat_reads" REPLICA IDENTITY FULL;


ALTER TABLE "public"."project_chat_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" "uuid",
    "consultant_id" "uuid",
    "role_in_project" "text" DEFAULT 'member'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_statuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "color" "text" DEFAULT '#6B7280'::"text",
    "icon" "text" DEFAULT 'Circle'::"text",
    "order_index" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."project_statuses" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."project_phases_with_status" AS
 SELECT "pp"."id",
    "pp"."project_id",
    "pp"."name",
    "pp"."slug",
    "pp"."description",
    "pp"."order_index",
    "pp"."status",
    "pp"."started_at",
    "pp"."completed_at",
    "pp"."created_at",
    "pp"."project_status_id",
    "ps"."name" AS "project_status_name",
    "ps"."slug" AS "project_status_slug",
    "ps"."color" AS "project_status_color",
    "ps"."icon" AS "project_status_icon",
    "p"."title" AS "project_title",
    "p"."cod_intern",
    ( SELECT "count"(*) AS "count"
           FROM "public"."project_activities" "pa"
          WHERE ("pa"."phase_id" = "pp"."id")) AS "total_activities",
    ( SELECT "count"(*) AS "count"
           FROM "public"."project_activities" "pa"
          WHERE (("pa"."phase_id" = "pp"."id") AND ("pa"."status" = 'completed'::"text"))) AS "completed_activities"
   FROM (("public"."project_phases" "pp"
     LEFT JOIN "public"."project_statuses" "ps" ON (("pp"."project_status_id" = "ps"."id")))
     LEFT JOIN "public"."projects" "p" ON (("pp"."project_id" = "p"."id")));


ALTER VIEW "public"."project_phases_with_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."project_progress_view" AS
 SELECT "pr"."id" AS "project_id",
    "pr"."title",
    "pr"."status",
    "pr"."cod_intern",
    "pr"."lifecycle_status",
    "pr"."current_phase_slug",
    "p"."name" AS "program_name",
    "pm"."name" AS "measure_name",
    "ms"."name" AS "session_name",
    ( SELECT "project_phases"."name"
           FROM "public"."project_phases"
          WHERE (("project_phases"."project_id" = "pr"."id") AND ("project_phases"."status" = 'in_progress'::"text"))
          ORDER BY "project_phases"."order_index"
         LIMIT 1) AS "current_phase_name",
    ( SELECT "count"(*) AS "count"
           FROM "public"."project_phases"
          WHERE ("project_phases"."project_id" = "pr"."id")) AS "total_phases",
    ( SELECT "count"(*) AS "count"
           FROM "public"."project_phases"
          WHERE (("project_phases"."project_id" = "pr"."id") AND ("project_phases"."status" = 'completed'::"text"))) AS "completed_phases",
    "round"((((( SELECT "count"(*) AS "count"
           FROM "public"."project_phases"
          WHERE (("project_phases"."project_id" = "pr"."id") AND ("project_phases"."status" = 'completed'::"text"))))::numeric / (NULLIF(( SELECT "count"(*) AS "count"
           FROM "public"."project_phases"
          WHERE ("project_phases"."project_id" = "pr"."id")), 0))::numeric) * (100)::numeric), 0) AS "progress_percent"
   FROM ((("public"."projects" "pr"
     LEFT JOIN "public"."programs" "p" ON (("p"."id" = "pr"."program_id")))
     LEFT JOIN "public"."program_measures" "pm" ON (("pm"."id" = "pr"."measure_id")))
     LEFT JOIN "public"."measure_sessions" "ms" ON (("ms"."id" = "pr"."session_id")));


ALTER VIEW "public"."project_progress_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "measure_id" "uuid",
    "is_default" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    CONSTRAINT "project_templates_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."project_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "recipient_id" "uuid",
    "recipient_email" "text",
    "recipient_kind" "text" NOT NULL,
    "threshold" "text" NOT NULL,
    "deadline_at" timestamp with time zone NOT NULL,
    "status" "text" NOT NULL,
    "source" "text" NOT NULL,
    "triggered_by" "uuid",
    "run_id" "uuid",
    "provider_id" "text",
    "send_index" integer DEFAULT 0 NOT NULL,
    "claim_token" "uuid",
    "claimed_at" timestamp with time zone,
    "claim_expires_at" timestamp with time zone,
    "skip_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    CONSTRAINT "reminder_log_entity_type_chk" CHECK (("entity_type" = ANY (ARRAY['request'::"text", 'activity'::"text"]))),
    CONSTRAINT "reminder_log_recipient_email_chk" CHECK ((("recipient_email" IS NOT NULL) OR ("source" = 'legacy'::"text"))),
    CONSTRAINT "reminder_log_recipient_kind_chk" CHECK (("recipient_kind" = ANY (ARRAY['client'::"text", 'consultant'::"text"]))),
    CONSTRAINT "reminder_log_send_index_chk" CHECK (("send_index" >= 0)),
    CONSTRAINT "reminder_log_source_chk" CHECK (("source" = ANY (ARRAY['cron'::"text", 'manual'::"text", 'legacy'::"text"]))),
    CONSTRAINT "reminder_log_source_context_chk" CHECK (((("source" = 'cron'::"text") AND ("run_id" IS NOT NULL) AND ("triggered_by" IS NULL)) OR (("source" = 'manual'::"text") AND ("triggered_by" IS NOT NULL)) OR (("source" = 'legacy'::"text") AND ("run_id" IS NULL) AND ("triggered_by" IS NULL)))),
    CONSTRAINT "reminder_log_state_chk" CHECK (((("status" = 'claimed'::"text") AND ("sent_at" IS NULL) AND ("claim_token" IS NOT NULL) AND ("claimed_at" IS NOT NULL) AND ("claim_expires_at" IS NOT NULL) AND ("skip_reason" IS NULL)) OR (("status" = 'sent'::"text") AND ("sent_at" IS NOT NULL) AND ("claim_token" IS NULL) AND ("claimed_at" IS NULL) AND ("claim_expires_at" IS NULL) AND ("skip_reason" IS NULL)) OR (("status" = 'skipped'::"text") AND ("sent_at" IS NULL) AND ("provider_id" IS NULL) AND ("claim_token" IS NULL) AND ("claimed_at" IS NULL) AND ("claim_expires_at" IS NULL) AND ("skip_reason" IS NOT NULL)))),
    CONSTRAINT "reminder_log_status_chk" CHECK (("status" = ANY (ARRAY['claimed'::"text", 'sent'::"text", 'skipped'::"text"]))),
    CONSTRAINT "reminder_log_threshold_chk" CHECK (("threshold" = ANY (ARRAY['1_week'::"text", '3_days'::"text", '1_day'::"text", 'same_day'::"text", 'overdue'::"text"])))
);


ALTER TABLE "public"."reminder_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."reminder_log" IS 'Audit journal for automatic and manual deadline reminders.';



COMMENT ON COLUMN "public"."reminder_log"."status" IS 'claimed is transient, sent means accepted by provider, skipped means consumed without email';



COMMENT ON COLUMN "public"."reminder_log"."send_index" IS 'Canonical first send uses 0; manual retries use 1, 2, ...';



CREATE TABLE IF NOT EXISTS "public"."reminder_run_lease" (
    "lease_name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."reminder_run_lease" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."sessions_overview" AS
 SELECT "ms"."id",
    "ms"."measure_id",
    "ms"."name",
    "ms"."code",
    "ms"."description",
    "ms"."submission_start_date",
    "ms"."submission_end_date",
    "ms"."total_budget",
    "ms"."remaining_budget",
    "ms"."status",
    "ms"."is_active",
    "ms"."created_at",
    "ms"."updated_at",
    "pm"."name" AS "measure_name",
    "pm"."slug" AS "measure_slug",
    "pm"."max_funding_amount",
    "pm"."co_financing_percent",
    "p"."name" AS "program_name",
    "p"."slug" AS "program_slug",
    ( SELECT "count"(*) AS "count"
           FROM "public"."projects"
          WHERE ("projects"."session_id" = "ms"."id")) AS "total_projects",
        CASE
            WHEN ("ms"."submission_end_date" IS NULL) THEN NULL::integer
            WHEN ("ms"."submission_end_date" < CURRENT_DATE) THEN 0
            ELSE ("ms"."submission_end_date" - CURRENT_DATE)
        END AS "days_remaining"
   FROM (("public"."measure_sessions" "ms"
     JOIN "public"."program_measures" "pm" ON (("pm"."id" = "ms"."measure_id")))
     JOIN "public"."programs" "p" ON (("p"."id" = "pm"."program_id")))
  WHERE ("ms"."is_active" = true)
  ORDER BY "p"."name", "pm"."name", "ms"."submission_start_date" DESC;


ALTER VIEW "public"."sessions_overview" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_phase_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "order_index" integer DEFAULT 0 NOT NULL,
    "estimated_days" integer,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "default_consultant_id" "uuid"
);


ALTER TABLE "public"."template_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_document_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_activity_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_mandatory" boolean DEFAULT false,
    "order_index" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "attachment_path" "text",
    "attachment_missing_at" timestamp with time zone,
    "attachment_missing_checked_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "attachment_original_name" "text",
    "requirement_type" "text" NOT NULL,
    "is_outgoing" boolean DEFAULT false NOT NULL,
    CONSTRAINT "template_document_requirements_requirement_type_check" CHECK (("requirement_type" = ANY (ARRAY['obligatoriu'::"text", 'daca_e_cazul'::"text", 'optional'::"text"])))
);


ALTER TABLE "public"."template_document_requirements" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."template_document_attachment_stale_references" AS
 SELECT "id",
    "template_activity_id",
    "name",
    "attachment_path",
    "attachment_missing_at",
    "attachment_missing_checked_at"
   FROM "public"."template_document_requirements" "tdr"
  WHERE (("attachment_path" IS NOT NULL) AND ("attachment_missing_at" IS NOT NULL));


ALTER VIEW "public"."template_document_attachment_stale_references" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_phases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "project_status_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "order_index" integer DEFAULT 0 NOT NULL,
    "estimated_days" integer,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."template_phases" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."templates_overview" AS
 SELECT "pt"."id",
    "pt"."name",
    "pt"."slug",
    "pt"."description",
    "pt"."measure_id",
    "pm"."name" AS "measure_name",
    "prog"."name" AS "program_name",
    "pt"."is_default",
    "pt"."is_active",
    "pt"."created_at",
    ( SELECT "count"(*) AS "count"
           FROM "public"."template_phases" "tp"
          WHERE ("tp"."template_id" = "pt"."id")) AS "total_phases",
    ( SELECT "count"(*) AS "count"
           FROM ("public"."template_activities" "ta"
             JOIN "public"."template_phases" "tp" ON (("ta"."template_phase_id" = "tp"."id")))
          WHERE ("tp"."template_id" = "pt"."id")) AS "total_activities",
    ( SELECT "count"(*) AS "count"
           FROM (("public"."template_document_requirements" "tdr"
             JOIN "public"."template_activities" "ta" ON (("tdr"."template_activity_id" = "ta"."id")))
             JOIN "public"."template_phases" "tp" ON (("ta"."template_phase_id" = "tp"."id")))
          WHERE ("tp"."template_id" = "pt"."id")) AS "total_documents"
   FROM (("public"."project_templates" "pt"
     LEFT JOIN "public"."program_measures" "pm" ON (("pt"."measure_id" = "pm"."id")))
     LEFT JOIN "public"."programs" "prog" ON (("pm"."program_id" = "prog"."id")));


ALTER VIEW "public"."templates_overview" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_document_files"
    ADD CONSTRAINT "activity_document_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_document_requirements"
    ADD CONSTRAINT "activity_document_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_request_reviews"
    ADD CONSTRAINT "document_request_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_requirement_attachments"
    ADD CONSTRAINT "document_requirement_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_upload_batches"
    ADD CONSTRAINT "document_upload_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_upload_batches"
    ADD CONSTRAINT "document_upload_batches_requirement_version_key" UNIQUE ("requirement_id", "version_number");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."measure_activity_templates"
    ADD CONSTRAINT "measure_activity_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."measure_phase_templates"
    ADD CONSTRAINT "measure_phase_templates_measure_id_slug_key" UNIQUE ("measure_id", "slug");



ALTER TABLE ONLY "public"."measure_phase_templates"
    ADD CONSTRAINT "measure_phase_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."measure_sessions"
    ADD CONSTRAINT "measure_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_event_key_key" UNIQUE ("user_id", "event_key");



ALTER TABLE ONLY "public"."private_conversation_participants"
    ADD CONSTRAINT "private_conversation_participants_pkey" PRIMARY KEY ("conversation_id", "user_id");



ALTER TABLE ONLY "public"."private_conversations"
    ADD CONSTRAINT "private_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."private_messages"
    ADD CONSTRAINT "private_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_measures"
    ADD CONSTRAINT "program_measures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_measures"
    ADD CONSTRAINT "program_measures_program_id_slug_key" UNIQUE ("program_id", "slug");



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."project_activities"
    ADD CONSTRAINT "project_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_chat_events"
    ADD CONSTRAINT "project_chat_events_pkey" PRIMARY KEY ("message_id");



ALTER TABLE ONLY "public"."project_chat_messages"
    ADD CONSTRAINT "project_chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_chat_reads"
    ADD CONSTRAINT "project_chat_reads_pkey" PRIMARY KEY ("project_id", "user_id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_consultant_id_key" UNIQUE ("project_id", "consultant_id");



ALTER TABLE ONLY "public"."project_phases"
    ADD CONSTRAINT "project_phases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_phases"
    ADD CONSTRAINT "project_phases_project_id_slug_key" UNIQUE ("project_id", "slug");



ALTER TABLE ONLY "public"."project_statuses"
    ADD CONSTRAINT "project_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_statuses"
    ADD CONSTRAINT "project_statuses_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_cod_intern_key" UNIQUE ("cod_intern");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_run_lease"
    ADD CONSTRAINT "reminder_run_lease_pkey" PRIMARY KEY ("lease_name");



ALTER TABLE ONLY "public"."template_activities"
    ADD CONSTRAINT "template_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_document_requirements"
    ADD CONSTRAINT "template_document_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_phases"
    ADD CONSTRAINT "template_phases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_phases"
    ADD CONSTRAINT "template_phases_template_id_slug_key" UNIQUE ("template_id", "slug");



CREATE INDEX "document_request_reviews_requirement_latest_idx" ON "public"."document_request_reviews" USING "btree" ("requirement_id", "reviewed_at" DESC);



CREATE UNIQUE INDEX "document_request_reviews_requirement_version_uidx" ON "public"."document_request_reviews" USING "btree" ("requirement_id", "reviewed_version_number");



CREATE INDEX "document_requirement_attachments_document_idx" ON "public"."document_requirement_attachments" USING "btree" ("document_requirement_id", "order_index", "created_at") WHERE ("document_requirement_id" IS NOT NULL);



CREATE UNIQUE INDEX "document_requirement_attachments_document_storage_uidx" ON "public"."document_requirement_attachments" USING "btree" ("document_requirement_id", "storage_path") WHERE ("document_requirement_id" IS NOT NULL);



CREATE INDEX "document_requirement_attachments_source_template_idx" ON "public"."document_requirement_attachments" USING "btree" ("source_template_attachment_id") WHERE ("source_template_attachment_id" IS NOT NULL);



CREATE INDEX "document_requirement_attachments_template_document_idx" ON "public"."document_requirement_attachments" USING "btree" ("template_document_requirement_id", "order_index", "created_at") WHERE ("template_document_requirement_id" IS NOT NULL);



CREATE UNIQUE INDEX "document_requirement_attachments_template_storage_uidx" ON "public"."document_requirement_attachments" USING "btree" ("template_document_requirement_id", "storage_path") WHERE ("template_document_requirement_id" IS NOT NULL);



CREATE INDEX "document_requirements_not_deleted_idx" ON "public"."document_requirements" USING "btree" ("project_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "document_requirements_project_order_idx" ON "public"."document_requirements" USING "btree" ("project_id", "activity_id", "order_index") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "document_requirements_project_source_template_idx" ON "public"."document_requirements" USING "btree" ("project_id", "source_template_document_requirement_id") WHERE ("source_template_document_requirement_id" IS NOT NULL);



CREATE INDEX "files_requirement_not_deleted_idx" ON "public"."files" USING "btree" ("requirement_id", "version_number" DESC, "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "files_requirement_upload_batch_storage_uidx" ON "public"."files" USING "btree" ("requirement_id", "upload_batch_id", "storage_path") WHERE (("upload_batch_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_activity_doc_files_requirement" ON "public"."activity_document_files" USING "btree" ("requirement_id");



CREATE INDEX "idx_activity_doc_files_status" ON "public"."activity_document_files" USING "btree" ("review_status");



CREATE INDEX "idx_activity_doc_files_uploaded_by" ON "public"."activity_document_files" USING "btree" ("uploaded_by");



CREATE INDEX "idx_activity_doc_req_activity" ON "public"."activity_document_requirements" USING "btree" ("activity_id");



CREATE INDEX "idx_activity_doc_req_status" ON "public"."activity_document_requirements" USING "btree" ("status");



CREATE INDEX "idx_activity_templates_phase" ON "public"."measure_activity_templates" USING "btree" ("phase_template_id");



CREATE INDEX "idx_audit_logs_action_created" ON "public"."audit_logs" USING "btree" ("action_type", "created_at" DESC);



CREATE INDEX "idx_audit_logs_created" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_entity" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_audit_logs_user_created" ON "public"."audit_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_document_requirements_activity" ON "public"."document_requirements" USING "btree" ("activity_id");



CREATE INDEX "idx_measures_active" ON "public"."program_measures" USING "btree" ("is_active");



CREATE INDEX "idx_measures_program" ON "public"."program_measures" USING "btree" ("program_id");



CREATE INDEX "idx_phase_templates_measure" ON "public"."measure_phase_templates" USING "btree" ("measure_id");



CREATE INDEX "idx_private_conversation_participants_user" ON "public"."private_conversation_participants" USING "btree" ("user_id");



CREATE INDEX "idx_private_conversations_last_message_at" ON "public"."private_conversations" USING "btree" ("last_message_at" DESC NULLS LAST);



CREATE INDEX "idx_private_messages_conversation_created_at" ON "public"."private_messages" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_programs_active" ON "public"."programs" USING "btree" ("is_active");



CREATE INDEX "idx_programs_slug" ON "public"."programs" USING "btree" ("slug");



CREATE INDEX "idx_project_activities_assigned_to" ON "public"."project_activities" USING "btree" ("assigned_to");



CREATE INDEX "idx_project_activities_deadline" ON "public"."project_activities" USING "btree" ("deadline_at");



CREATE INDEX "idx_project_activities_phase_id" ON "public"."project_activities" USING "btree" ("phase_id");



CREATE INDEX "idx_project_activities_status" ON "public"."project_activities" USING "btree" ("status");



CREATE INDEX "idx_project_chat_events_project_changed" ON "public"."project_chat_events" USING "btree" ("project_id", "changed_at" DESC);



CREATE INDEX "idx_project_chat_messages_unread_lookup" ON "public"."project_chat_messages" USING "btree" ("project_id", "created_at" DESC) INCLUDE ("created_by") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_project_chat_reads_project_read" ON "public"."project_chat_reads" USING "btree" ("project_id", "last_read_at");



CREATE INDEX "idx_project_chat_reads_user_read" ON "public"."project_chat_reads" USING "btree" ("user_id", "last_read_at");



CREATE INDEX "idx_project_phases_project_id" ON "public"."project_phases" USING "btree" ("project_id");



CREATE INDEX "idx_project_phases_status" ON "public"."project_phases" USING "btree" ("status");



CREATE INDEX "idx_project_statuses_order" ON "public"."project_statuses" USING "btree" ("order_index");



CREATE INDEX "idx_project_templates_measure" ON "public"."project_templates" USING "btree" ("measure_id");



CREATE INDEX "idx_projects_measure" ON "public"."projects" USING "btree" ("measure_id");



CREATE INDEX "idx_projects_program" ON "public"."projects" USING "btree" ("program_id");



CREATE INDEX "idx_projects_session" ON "public"."projects" USING "btree" ("session_id");



CREATE INDEX "idx_projects_status" ON "public"."projects" USING "btree" ("current_status_id");



CREATE INDEX "idx_sessions_dates" ON "public"."measure_sessions" USING "btree" ("submission_start_date", "submission_end_date");



CREATE INDEX "idx_sessions_measure" ON "public"."measure_sessions" USING "btree" ("measure_id");



CREATE INDEX "idx_sessions_status" ON "public"."measure_sessions" USING "btree" ("status");



CREATE INDEX "idx_template_activities_order" ON "public"."template_activities" USING "btree" ("template_phase_id", "order_index");



CREATE INDEX "idx_template_activities_phase" ON "public"."template_activities" USING "btree" ("template_phase_id");



CREATE INDEX "idx_template_doc_req_activity" ON "public"."template_document_requirements" USING "btree" ("template_activity_id");



CREATE INDEX "idx_template_phases_order" ON "public"."template_phases" USING "btree" ("template_id", "order_index");



CREATE INDEX "idx_template_phases_status" ON "public"."template_phases" USING "btree" ("project_status_id");



CREATE INDEX "idx_template_phases_template" ON "public"."template_phases" USING "btree" ("template_id");



CREATE INDEX "notifications_user_created_id_idx" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC, "id" DESC) WHERE ("dismissed_at" IS NULL);



CREATE INDEX "notifications_user_project_unread_idx" ON "public"."notifications" USING "btree" ("user_id", "project_id") WHERE (("read_at" IS NULL) AND ("dismissed_at" IS NULL));



CREATE UNIQUE INDEX "project_activities_phase_source_template_idx" ON "public"."project_activities" USING "btree" ("phase_id", "source_template_activity_id") WHERE ("source_template_activity_id" IS NOT NULL);



CREATE INDEX "project_chat_messages_created_by_idx" ON "public"."project_chat_messages" USING "btree" ("created_by");



CREATE INDEX "project_chat_messages_project_not_deleted_time_idx" ON "public"."project_chat_messages" USING "btree" ("project_id", "deleted_at", "created_at" DESC);



CREATE INDEX "project_chat_messages_project_time_idx" ON "public"."project_chat_messages" USING "btree" ("project_id", "created_at" DESC);



CREATE UNIQUE INDEX "project_phases_project_source_template_idx" ON "public"."project_phases" USING "btree" ("project_id", "source_template_phase_id") WHERE ("source_template_phase_id" IS NOT NULL);



CREATE INDEX "reminder_log_claim_expiry_idx" ON "public"."reminder_log" USING "btree" ("claim_expires_at") WHERE ("status" = 'claimed'::"text");



CREATE UNIQUE INDEX "reminder_log_dedup_idx" ON "public"."reminder_log" USING "btree" ("entity_type", "entity_id", "recipient_id", "threshold", "deadline_at", "send_index");



CREATE INDEX "reminder_log_project_deadline_idx" ON "public"."reminder_log" USING "btree" ("project_id", "deadline_at");



CREATE INDEX "reminder_log_recipient_deadline_idx" ON "public"."reminder_log" USING "btree" ("recipient_id", "deadline_at");



CREATE INDEX "reminder_log_run_idx" ON "public"."reminder_log" USING "btree" ("run_id") WHERE ("run_id" IS NOT NULL);



CREATE INDEX "reminder_log_status_idx" ON "public"."reminder_log" USING "btree" ("entity_type", "entity_id", "status", "threshold", "deadline_at");



CREATE OR REPLACE TRIGGER "audit_logs_append_only" BEFORE DELETE OR UPDATE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_logs_mutation"();



CREATE OR REPLACE TRIGGER "trg_notify_document_request_assignment" AFTER UPDATE OF "assigned_to" ON "public"."document_requirements" FOR EACH ROW WHEN ((("old"."assigned_to" IS DISTINCT FROM "new"."assigned_to") AND ("new"."assigned_to" IS NOT NULL))) EXECUTE FUNCTION "public"."notify_document_request_assignment"();



CREATE OR REPLACE TRIGGER "trg_notify_project_activity_assignment" AFTER UPDATE OF "assigned_to" ON "public"."project_activities" FOR EACH ROW WHEN ((("old"."assigned_to" IS DISTINCT FROM "new"."assigned_to") AND ("new"."assigned_to" IS NOT NULL))) EXECUTE FUNCTION "public"."notify_project_activity_assignment"();



CREATE OR REPLACE TRIGGER "trg_project_chat_author_read" AFTER INSERT ON "public"."project_chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."mark_project_chat_author_read"();



CREATE OR REPLACE TRIGGER "trg_project_chat_messages_emit_event" AFTER INSERT OR UPDATE ON "public"."project_chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."project_chat_messages_emit_event"();



CREATE OR REPLACE TRIGGER "trg_project_chat_read_for_project_client" AFTER INSERT OR UPDATE OF "client_id" ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_project_chat_read_for_project_client"();



CREATE OR REPLACE TRIGGER "trg_project_chat_read_for_project_member" AFTER INSERT OR UPDATE OF "consultant_id" ON "public"."project_members" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_project_chat_read_for_project_member"();



CREATE OR REPLACE TRIGGER "trg_project_chat_reads_updated_at" BEFORE UPDATE ON "public"."project_chat_reads" FOR EACH ROW EXECUTE FUNCTION "public"."set_project_chat_reads_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_requirement_type" BEFORE INSERT OR UPDATE ON "public"."document_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."sync_requirement_type"();



CREATE OR REPLACE TRIGGER "trg_sync_requirement_type" BEFORE INSERT OR UPDATE ON "public"."template_document_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."sync_requirement_type"();



CREATE OR REPLACE TRIGGER "trigger_activities_updated_at" BEFORE UPDATE ON "public"."project_activities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_activity_doc_req_updated" BEFORE UPDATE ON "public"."activity_document_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_create_project_phases" AFTER INSERT ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."create_project_phases_from_measure"();



CREATE OR REPLACE TRIGGER "trigger_generate_cod_intern" BEFORE INSERT ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."generate_cod_intern_safe"();



CREATE OR REPLACE TRIGGER "trigger_measures_updated" BEFORE UPDATE ON "public"."program_measures" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_programs_updated" BEFORE UPDATE ON "public"."programs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_sessions_updated" BEFORE UPDATE ON "public"."measure_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trigger_update_req_status_insert" AFTER INSERT ON "public"."activity_document_files" FOR EACH ROW EXECUTE FUNCTION "public"."update_requirement_status"();



CREATE OR REPLACE TRIGGER "trigger_update_req_status_update" AFTER UPDATE ON "public"."activity_document_files" FOR EACH ROW EXECUTE FUNCTION "public"."update_requirement_status"();



CREATE OR REPLACE TRIGGER "update_project_statuses_updated_at" BEFORE UPDATE ON "public"."project_statuses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_project_templates_updated_at" BEFORE UPDATE ON "public"."project_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."activity_document_files"
    ADD CONSTRAINT "activity_document_files_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."activity_document_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_document_files"
    ADD CONSTRAINT "activity_document_files_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_document_files"
    ADD CONSTRAINT "activity_document_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_document_requirements"
    ADD CONSTRAINT "activity_document_requirements_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."project_activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_document_requirements"
    ADD CONSTRAINT "activity_document_requirements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_request_reviews"
    ADD CONSTRAINT "document_request_reviews_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."document_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_request_reviews"
    ADD CONSTRAINT "document_request_reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."document_requirement_attachments"
    ADD CONSTRAINT "document_requirement_attachme_source_template_attachment_i_fkey" FOREIGN KEY ("source_template_attachment_id") REFERENCES "public"."document_requirement_attachments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_requirement_attachments"
    ADD CONSTRAINT "document_requirement_attachme_template_document_requiremen_fkey" FOREIGN KEY ("template_document_requirement_id") REFERENCES "public"."template_document_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_requirement_attachments"
    ADD CONSTRAINT "document_requirement_attachments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."document_requirement_attachments"
    ADD CONSTRAINT "document_requirement_attachments_document_requirement_id_fkey" FOREIGN KEY ("document_requirement_id") REFERENCES "public"."document_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."project_activities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_source_template_document_requirement_fkey" FOREIGN KEY ("source_template_document_requirement_id") REFERENCES "public"."template_document_requirements"("id");



ALTER TABLE ONLY "public"."document_upload_batches"
    ADD CONSTRAINT "document_upload_batches_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."document_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_upload_batches"
    ADD CONSTRAINT "document_upload_batches_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."document_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."measure_activity_templates"
    ADD CONSTRAINT "measure_activity_templates_phase_template_id_fkey" FOREIGN KEY ("phase_template_id") REFERENCES "public"."measure_phase_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."measure_phase_templates"
    ADD CONSTRAINT "measure_phase_templates_measure_id_fkey" FOREIGN KEY ("measure_id") REFERENCES "public"."program_measures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."measure_sessions"
    ADD CONSTRAINT "measure_sessions_measure_id_fkey" FOREIGN KEY ("measure_id") REFERENCES "public"."program_measures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_conversation_participants"
    ADD CONSTRAINT "private_conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."private_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_conversation_participants"
    ADD CONSTRAINT "private_conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_conversations"
    ADD CONSTRAINT "private_conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_messages"
    ADD CONSTRAINT "private_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."private_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_messages"
    ADD CONSTRAINT "private_messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_measures"
    ADD CONSTRAINT "program_measures_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_activities"
    ADD CONSTRAINT "project_activities_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_activities"
    ADD CONSTRAINT "project_activities_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_activities"
    ADD CONSTRAINT "project_activities_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_activities"
    ADD CONSTRAINT "project_activities_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_activities"
    ADD CONSTRAINT "project_activities_source_template_activity_id_fkey" FOREIGN KEY ("source_template_activity_id") REFERENCES "public"."template_activities"("id");



ALTER TABLE ONLY "public"."project_chat_events"
    ADD CONSTRAINT "project_chat_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."project_chat_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_chat_events"
    ADD CONSTRAINT "project_chat_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_chat_messages"
    ADD CONSTRAINT "project_chat_messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."project_chat_messages"
    ADD CONSTRAINT "project_chat_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_chat_reads"
    ADD CONSTRAINT "project_chat_reads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_chat_reads"
    ADD CONSTRAINT "project_chat_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_consultant_id_fkey" FOREIGN KEY ("consultant_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_phases"
    ADD CONSTRAINT "project_phases_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_phases"
    ADD CONSTRAINT "project_phases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_phases"
    ADD CONSTRAINT "project_phases_project_status_id_fkey" FOREIGN KEY ("project_status_id") REFERENCES "public"."project_statuses"("id");



ALTER TABLE ONLY "public"."project_phases"
    ADD CONSTRAINT "project_phases_source_template_phase_id_fkey" FOREIGN KEY ("source_template_phase_id") REFERENCES "public"."template_phases"("id");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_measure_id_fkey" FOREIGN KEY ("measure_id") REFERENCES "public"."program_measures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_current_status_id_fkey" FOREIGN KEY ("current_status_id") REFERENCES "public"."project_statuses"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_general_consultant_id_fkey" FOREIGN KEY ("general_consultant_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_measure_id_fkey" FOREIGN KEY ("measure_id") REFERENCES "public"."program_measures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."measure_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminder_log"
    ADD CONSTRAINT "reminder_log_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."template_activities"
    ADD CONSTRAINT "template_activities_default_consultant_id_fkey" FOREIGN KEY ("default_consultant_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."template_activities"
    ADD CONSTRAINT "template_activities_template_phase_id_fkey" FOREIGN KEY ("template_phase_id") REFERENCES "public"."template_phases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_document_requirements"
    ADD CONSTRAINT "template_document_requirements_template_activity_id_fkey" FOREIGN KEY ("template_activity_id") REFERENCES "public"."template_activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_phases"
    ADD CONSTRAINT "template_phases_project_status_id_fkey" FOREIGN KEY ("project_status_id") REFERENCES "public"."project_statuses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."template_phases"
    ADD CONSTRAINT "template_phases_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE CASCADE;



CREATE POLICY "Admin All Projects" ON "public"."projects" USING ("public"."is_admin"());



CREATE POLICY "Admin All Tasks" ON "public"."document_requirements" USING ("public"."is_admin"());



CREATE POLICY "Admin can add members" ON "public"."project_members" FOR INSERT WITH CHECK (("public"."get_my_role"() = 'admin'::"text"));



CREATE POLICY "Admin can remove members" ON "public"."project_members" FOR DELETE USING (("public"."get_my_role"() = 'admin'::"text"));



CREATE POLICY "Admins can update all profiles" ON "public"."profiles" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "profiles_1"
  WHERE (("profiles_1"."id" = "auth"."uid"()) AND ("profiles_1"."role" = 'admin'::"text")))));



CREATE POLICY "Allow all authenticated reads" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated to insert document_requirements" ON "public"."document_requirements" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated to insert files" ON "public"."files" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated to read document_requirements" ON "public"."document_requirements" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated to read files" ON "public"."files" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated to read project_members" ON "public"."project_members" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated to update document_requirements" ON "public"."document_requirements" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated to update files" ON "public"."files" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Client View Own Project" ON "public"."projects" FOR SELECT USING (("client_id" = "auth"."uid"()));



CREATE POLICY "Client View Tasks" ON "public"."document_requirements" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "document_requirements"."project_id") AND ("projects"."client_id" = "auth"."uid"())))));



CREATE POLICY "Consultant Manage Tasks" ON "public"."document_requirements" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "document_requirements"."project_id") AND ("project_members"."consultant_id" = "auth"."uid"())))));



CREATE POLICY "Consultant View Team Projects" ON "public"."projects" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "projects"."id") AND ("project_members"."consultant_id" = "auth"."uid"())))));



CREATE POLICY "Doar admin poate modifica activități template" ON "public"."template_activities" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Doar admin poate modifica doc requirements template" ON "public"."template_document_requirements" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Doar admin poate modifica faze template" ON "public"."template_phases" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Doar admin poate modifica statusuri" ON "public"."project_statuses" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Doar admin poate modifica template-uri" ON "public"."project_templates" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Toți pot vedea activitățile template" ON "public"."template_activities" FOR SELECT USING (true);



CREATE POLICY "Toți pot vedea doc requirements template" ON "public"."template_document_requirements" FOR SELECT USING (true);



CREATE POLICY "Toți pot vedea fazele template" ON "public"."template_phases" FOR SELECT USING (true);



CREATE POLICY "Toți pot vedea statusurile" ON "public"."project_statuses" FOR SELECT USING (true);



CREATE POLICY "Toți pot vedea template-urile active" ON "public"."project_templates" FOR SELECT USING ((("is_active" = true) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text"))))));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "activities_admin_all" ON "public"."project_activities" USING ("public"."is_admin"());



CREATE POLICY "activities_client_select" ON "public"."project_activities" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."project_phases" "ph"
     JOIN "public"."projects" "pr" ON (("pr"."id" = "ph"."project_id")))
  WHERE (("ph"."id" = "project_activities"."phase_id") AND ("pr"."client_id" = "auth"."uid"())))));



CREATE POLICY "activities_consultant_select" ON "public"."project_activities" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."project_phases" "ph"
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "ph"."project_id")))
  WHERE (("ph"."id" = "project_activities"."phase_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



CREATE POLICY "activities_consultant_update" ON "public"."project_activities" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."project_phases" "ph"
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "ph"."project_id")))
  WHERE (("ph"."id" = "project_activities"."phase_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



ALTER TABLE "public"."activity_document_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_document_requirements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_templates_admin" ON "public"."measure_activity_templates" USING ("public"."is_admin"());



CREATE POLICY "activity_templates_select" ON "public"."measure_activity_templates" FOR SELECT USING (true);



CREATE POLICY "audit_admin_select" ON "public"."audit_logs" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "audit_insert" ON "public"."audit_logs" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_messages_insert" ON "public"."project_chat_messages" FOR INSERT WITH CHECK (("public"."can_access_project"("project_id") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "chat_messages_select" ON "public"."project_chat_messages" FOR SELECT USING ("public"."can_access_project"("project_id"));



CREATE POLICY "chat_messages_update_own" ON "public"."project_chat_messages" FOR UPDATE USING ((("created_by" = "auth"."uid"()) AND ("deleted_at" IS NULL))) WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "doc_files_admin_all" ON "public"."activity_document_files" USING ("public"."is_admin"());



CREATE POLICY "doc_files_client_insert" ON "public"."activity_document_files" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((("public"."activity_document_requirements" "adr"
     JOIN "public"."project_activities" "pa" ON (("pa"."id" = "adr"."activity_id")))
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "pa"."phase_id")))
     JOIN "public"."projects" "pr" ON (("pr"."id" = "ph"."project_id")))
  WHERE (("adr"."id" = "activity_document_files"."requirement_id") AND ("pr"."client_id" = "auth"."uid"())))));



CREATE POLICY "doc_files_client_select" ON "public"."activity_document_files" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((("public"."activity_document_requirements" "adr"
     JOIN "public"."project_activities" "pa" ON (("pa"."id" = "adr"."activity_id")))
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "pa"."phase_id")))
     JOIN "public"."projects" "pr" ON (("pr"."id" = "ph"."project_id")))
  WHERE (("adr"."id" = "activity_document_files"."requirement_id") AND ("pr"."client_id" = "auth"."uid"())))));



CREATE POLICY "doc_files_consultant_select" ON "public"."activity_document_files" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((("public"."activity_document_requirements" "adr"
     JOIN "public"."project_activities" "pa" ON (("pa"."id" = "adr"."activity_id")))
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "pa"."phase_id")))
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "ph"."project_id")))
  WHERE (("adr"."id" = "activity_document_files"."requirement_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



CREATE POLICY "doc_files_consultant_update" ON "public"."activity_document_files" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ((("public"."activity_document_requirements" "adr"
     JOIN "public"."project_activities" "pa" ON (("pa"."id" = "adr"."activity_id")))
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "pa"."phase_id")))
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "ph"."project_id")))
  WHERE (("adr"."id" = "activity_document_files"."requirement_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



CREATE POLICY "doc_req_admin_all" ON "public"."activity_document_requirements" USING ("public"."is_admin"());



CREATE POLICY "doc_req_client_select" ON "public"."activity_document_requirements" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."project_activities" "pa"
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "pa"."phase_id")))
     JOIN "public"."projects" "pr" ON (("pr"."id" = "ph"."project_id")))
  WHERE (("pa"."id" = "activity_document_requirements"."activity_id") AND ("pr"."client_id" = "auth"."uid"())))));



CREATE POLICY "doc_req_consultant_insert" ON "public"."activity_document_requirements" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."project_activities" "pa"
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "pa"."phase_id")))
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "ph"."project_id")))
  WHERE (("pa"."id" = "activity_document_requirements"."activity_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



CREATE POLICY "doc_req_consultant_select" ON "public"."activity_document_requirements" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."project_activities" "pa"
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "pa"."phase_id")))
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "ph"."project_id")))
  WHERE (("pa"."id" = "activity_document_requirements"."activity_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



CREATE POLICY "doc_req_consultant_update" ON "public"."activity_document_requirements" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (("public"."project_activities" "pa"
     JOIN "public"."project_phases" "ph" ON (("ph"."id" = "pa"."phase_id")))
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "ph"."project_id")))
  WHERE (("pa"."id" = "activity_document_requirements"."activity_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



ALTER TABLE "public"."document_request_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_requirement_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_upload_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."measure_activity_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."measure_phase_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."measure_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "measures_delete" ON "public"."program_measures" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "measures_insert" ON "public"."program_measures" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "measures_select" ON "public"."program_measures" FOR SELECT USING (true);



CREATE POLICY "measures_update" ON "public"."program_measures" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_select_own_accessible" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."can_select_notification"("project_id", "entity_type", "entity_id")));



CREATE POLICY "phase_templates_admin" ON "public"."measure_phase_templates" USING ("public"."is_admin"());



CREATE POLICY "phase_templates_select" ON "public"."measure_phase_templates" FOR SELECT USING (true);



CREATE POLICY "phases_admin_all" ON "public"."project_phases" USING ("public"."is_admin"());



CREATE POLICY "phases_client_select" ON "public"."project_phases" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "pr"
  WHERE (("pr"."id" = "project_phases"."project_id") AND ("pr"."client_id" = "auth"."uid"())))));



CREATE POLICY "phases_consultant_select" ON "public"."project_phases" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_phases"."project_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



CREATE POLICY "phases_consultant_update" ON "public"."project_phases" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_phases"."project_id") AND ("pm"."consultant_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_phases"."project_id") AND ("pm"."consultant_id" = "auth"."uid"())))));



ALTER TABLE "public"."private_conversation_participants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "private_conversation_participants_select_own_row" ON "public"."private_conversation_participants" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "private_conversation_participants_update_own_last_read" ON "public"."private_conversation_participants" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."private_conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "private_conversations_insert_own_only" ON "public"."private_conversations" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "private_conversations_select_participants_only" ON "public"."private_conversations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."private_conversation_participants" "p"
  WHERE (("p"."conversation_id" = "private_conversations"."id") AND ("p"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."private_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "private_messages_delete_own_only" ON "public"."private_messages" FOR DELETE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "private_messages_insert_participant_only" ON "public"."private_messages" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."private_conversation_participants" "p"
  WHERE (("p"."conversation_id" = "private_messages"."conversation_id") AND ("p"."user_id" = "auth"."uid"()))))));



CREATE POLICY "private_messages_select_participants_only" ON "public"."private_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."private_conversation_participants" "p"
  WHERE (("p"."conversation_id" = "private_messages"."conversation_id") AND ("p"."user_id" = "auth"."uid"())))));



CREATE POLICY "private_messages_update_own_only" ON "public"."private_messages" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."program_measures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."programs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "programs_delete" ON "public"."programs" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "programs_insert" ON "public"."programs" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "programs_select" ON "public"."programs" FOR SELECT USING (true);



CREATE POLICY "programs_update" ON "public"."programs" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."project_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_chat_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_chat_events_select_accessible_projects" ON "public"."project_chat_events" FOR SELECT TO "authenticated" USING ("public"."can_select_project_chat_read"("project_id"));



ALTER TABLE "public"."project_chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_chat_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_chat_reads_select_accessible_projects" ON "public"."project_chat_reads" FOR SELECT TO "authenticated" USING ("public"."can_select_project_chat_read"("project_id"));



ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_phases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminder_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminder_run_lease" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions_delete" ON "public"."measure_sessions" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "sessions_insert" ON "public"."measure_sessions" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "sessions_select" ON "public"."measure_sessions" FOR SELECT USING (true);



CREATE POLICY "sessions_update" ON "public"."measure_sessions" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."template_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_document_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_phases" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT ALL ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."acquire_reminder_run_lease"("p_lease_name" "text", "p_owner_id" "uuid", "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acquire_reminder_run_lease"("p_lease_name" "text", "p_owner_id" "uuid", "p_lease_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."add_session"("p_measure_id" "uuid", "p_name" "text", "p_code" "text", "p_start_date" "date", "p_end_date" "date", "p_budget" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."add_session"("p_measure_id" "uuid", "p_name" "text", "p_code" "text", "p_start_date" "date", "p_end_date" "date", "p_budget" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_session"("p_measure_id" "uuid", "p_name" "text", "p_code" "text", "p_start_date" "date", "p_end_date" "date", "p_budget" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."advance_project_phase"("p_project_id" "uuid", "p_complete_current" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."advance_project_phase"("p_project_id" "uuid", "p_complete_current" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_project_phase"("p_project_id" "uuid", "p_complete_current" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."advance_project_status"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."advance_project_status"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_project_status"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assignment_notifications_suppressed"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assignment_notifications_suppressed"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_log_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_log_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_log_distinct_types"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_log_distinct_types"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_logs_contract"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_logs_contract"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_access_project"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_project"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_project"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_select_notification"("p_project_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_select_notification"("p_project_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_select_notification"("p_project_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_select_project_chat_read"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_select_project_chat_read"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_select_project_chat_read"("p_project_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_reminder_slot"("p_entity_type" "text", "p_entity_id" "uuid", "p_project_id" "uuid", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_recipient_kind" "text", "p_threshold" "text", "p_deadline_at" timestamp with time zone, "p_source" "text", "p_triggered_by" "uuid", "p_run_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_reminder_slot"("p_entity_type" "text", "p_entity_id" "uuid", "p_project_id" "uuid", "p_recipient_id" "uuid", "p_recipient_email" "text", "p_recipient_kind" "text", "p_threshold" "text", "p_deadline_at" timestamp with time zone, "p_source" "text", "p_triggered_by" "uuid", "p_run_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_document_upload_batch"("p_requirement_id" "uuid", "p_upload_batch_id" "uuid", "p_version_number" integer, "p_uploaded_by" "uuid", "p_rows" "jsonb", "p_ip_address" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_document_upload_batch"("p_requirement_id" "uuid", "p_upload_batch_id" "uuid", "p_version_number" integer, "p_uploaded_by" "uuid", "p_rows" "jsonb", "p_ip_address" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_reserved_document_upload_batch"("p_upload_batch_id" "uuid", "p_actor_id" "uuid", "p_selected_file_ids" "jsonb", "p_ip_address" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_reserved_document_upload_batch"("p_upload_batch_id" "uuid", "p_actor_id" "uuid", "p_selected_file_ids" "jsonb", "p_ip_address" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_project_phases_from_measure"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_project_phases_from_measure"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_project_phases_from_measure"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_project_activity_preserving_requests"("project_id" "uuid", "phase_id" "uuid", "activity_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_project_activity_preserving_requests"("project_id" "uuid", "phase_id" "uuid", "activity_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_project_phase_preserving_requests"("project_id" "uuid", "phase_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_project_phase_preserving_requests"("project_id" "uuid", "phase_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."dismiss_notifications"("p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dismiss_notifications"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dismiss_notifications"("p_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_project_chat_read_for_project_client"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_project_chat_read_for_project_client"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_project_chat_read_for_project_client"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_project_chat_read_for_project_member"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_project_chat_read_for_project_member"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_project_chat_read_for_project_member"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_reminder_claim"("p_log_id" "uuid", "p_claim_token" "uuid", "p_provider_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_reminder_claim"("p_log_id" "uuid", "p_claim_token" "uuid", "p_provider_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_cod_intern_safe"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_cod_intern_safe"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_cod_intern_safe"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_cod_intern"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_cod_intern"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_cod_intern"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_upcoming_deadlines"("p_days" integer, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_upcoming_deadlines"("p_days" integer, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_upcoming_deadlines"("p_days" integer, "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."import_template_to_project"("p_project_id" "uuid", "p_template_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."import_template_to_project"("p_project_id" "uuid", "p_template_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_template_to_project"("p_project_id" "uuid", "p_template_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_notification_event"("p_project_id" "uuid", "p_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_title" "text", "p_item_count" integer, "p_event_key" "text", "p_recipient_id" "uuid", "p_include_admins" boolean, "p_fallback_to_project_members" boolean, "p_require_recipient" boolean, "p_severity" "text", "p_actor_name" "text", "p_entity_label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_notification_event"("p_project_id" "uuid", "p_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_title" "text", "p_item_count" integer, "p_event_key" "text", "p_recipient_id" "uuid", "p_include_admins" boolean, "p_fallback_to_project_members" boolean, "p_require_recipient" boolean, "p_severity" "text", "p_actor_name" "text", "p_entity_label" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_consultant_member_of_project"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_consultant_member_of_project"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_consultant_member_of_project"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit"("p_action_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_name" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit"("p_action_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_name" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit"("p_action_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_name" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_notifications_read"("p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_notifications_read"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_notifications_read"("p_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_notifications_unread"("p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_notifications_unread"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_notifications_unread"("p_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_project_chat_author_read"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_project_chat_author_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_project_chat_author_read"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notification_entity_label"("p_entity_type" "text", "p_entity_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notification_entity_label"("p_entity_type" "text", "p_entity_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notification_entity_label"("p_entity_type" "text", "p_entity_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notification_unread_summary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notification_unread_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notification_unread_summary"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_document_request_assignment"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_document_request_assignment"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_project_activity_assignment"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_project_activity_assignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_audit_logs_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_audit_logs_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_audit_logs_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."project_chat_messages_emit_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."project_chat_messages_emit_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_chat_messages_emit_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_reminder_claim"("p_log_id" "uuid", "p_claim_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_reminder_claim"("p_log_id" "uuid", "p_claim_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_reminder_run_lease"("p_lease_name" "text", "p_owner_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_reminder_run_lease"("p_lease_name" "text", "p_owner_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_project_member_if_unassigned"("p_project_id" "uuid", "p_member_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_project_member_if_unassigned"("p_project_id" "uuid", "p_member_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."revert_project_phase"("p_project_id" "uuid", "p_target_phase_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."revert_project_phase"("p_project_id" "uuid", "p_target_phase_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_project_phase"("p_project_id" "uuid", "p_target_phase_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_document_request"("p_request_id" "uuid", "p_action" "text", "p_reason" "text", "p_reviewed_by" "uuid", "p_ip_address" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_document_request"("p_request_id" "uuid", "p_action" "text", "p_reason" "text", "p_reviewed_by" "uuid", "p_ip_address" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_project_chat_reads_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_project_chat_reads_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_project_chat_reads_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."shift_project_activities_after_duplicate"("p_phase_id" "uuid", "p_source_activity_id" "uuid", "p_copy_activity_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."shift_project_activities_after_duplicate"("p_phase_id" "uuid", "p_source_activity_id" "uuid", "p_copy_activity_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."shift_project_phases_after_duplicate"("p_project_id" "uuid", "p_source_phase_id" "uuid", "p_copy_phase_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."shift_project_phases_after_duplicate"("p_project_id" "uuid", "p_source_phase_id" "uuid", "p_copy_phase_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_requirement_type"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_requirement_type"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_requirement_type"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_requirement_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_requirement_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_requirement_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."activity_document_files" TO "anon";
GRANT ALL ON TABLE "public"."activity_document_files" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_document_files" TO "service_role";



GRANT ALL ON TABLE "public"."activity_document_requirements" TO "anon";
GRANT ALL ON TABLE "public"."activity_document_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_document_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."project_activities" TO "anon";
GRANT ALL ON TABLE "public"."project_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."project_activities" TO "service_role";



GRANT ALL ON TABLE "public"."project_phases" TO "anon";
GRANT ALL ON TABLE "public"."project_phases" TO "authenticated";
GRANT ALL ON TABLE "public"."project_phases" TO "service_role";



GRANT ALL ON TABLE "public"."activity_documents_status" TO "anon";
GRANT ALL ON TABLE "public"."activity_documents_status" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_documents_status" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."document_request_reviews" TO "anon";
GRANT ALL ON TABLE "public"."document_request_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."document_request_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."document_requirement_attachments" TO "anon";
GRANT ALL ON TABLE "public"."document_requirement_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."document_requirement_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."document_requirements" TO "anon";
GRANT ALL ON TABLE "public"."document_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."document_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."document_upload_batches" TO "service_role";



GRANT ALL ON TABLE "public"."files" TO "anon";
GRANT ALL ON TABLE "public"."files" TO "authenticated";
GRANT ALL ON TABLE "public"."files" TO "service_role";



GRANT ALL ON TABLE "public"."measure_sessions" TO "anon";
GRANT ALL ON TABLE "public"."measure_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."measure_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."program_measures" TO "anon";
GRANT ALL ON TABLE "public"."program_measures" TO "authenticated";
GRANT ALL ON TABLE "public"."program_measures" TO "service_role";



GRANT ALL ON TABLE "public"."programs" TO "anon";
GRANT ALL ON TABLE "public"."programs" TO "authenticated";
GRANT ALL ON TABLE "public"."programs" TO "service_role";



GRANT ALL ON TABLE "public"."funding_hierarchy" TO "anon";
GRANT ALL ON TABLE "public"."funding_hierarchy" TO "authenticated";
GRANT ALL ON TABLE "public"."funding_hierarchy" TO "service_role";



GRANT ALL ON TABLE "public"."measure_activity_templates" TO "anon";
GRANT ALL ON TABLE "public"."measure_activity_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."measure_activity_templates" TO "service_role";



GRANT ALL ON TABLE "public"."measure_phase_templates" TO "anon";
GRANT ALL ON TABLE "public"."measure_phase_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."measure_phase_templates" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."measures_overview" TO "anon";
GRANT ALL ON TABLE "public"."measures_overview" TO "authenticated";
GRANT ALL ON TABLE "public"."measures_overview" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "service_role";
GRANT SELECT ON TABLE "public"."notifications" TO "authenticated";



GRANT ALL ON TABLE "public"."private_conversation_participants" TO "anon";
GRANT ALL ON TABLE "public"."private_conversation_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."private_conversation_participants" TO "service_role";



GRANT ALL ON TABLE "public"."private_conversations" TO "anon";
GRANT ALL ON TABLE "public"."private_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."private_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."private_messages" TO "anon";
GRANT ALL ON TABLE "public"."private_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."private_messages" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."programs_overview" TO "anon";
GRANT ALL ON TABLE "public"."programs_overview" TO "authenticated";
GRANT ALL ON TABLE "public"."programs_overview" TO "service_role";



GRANT ALL ON TABLE "public"."project_activities_complete" TO "anon";
GRANT ALL ON TABLE "public"."project_activities_complete" TO "authenticated";
GRANT ALL ON TABLE "public"."project_activities_complete" TO "service_role";



GRANT ALL ON TABLE "public"."project_chat_events" TO "anon";
GRANT ALL ON TABLE "public"."project_chat_events" TO "authenticated";
GRANT ALL ON TABLE "public"."project_chat_events" TO "service_role";



GRANT ALL ON TABLE "public"."project_chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."project_chat_reads" TO "anon";
GRANT ALL ON TABLE "public"."project_chat_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."project_chat_reads" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."project_statuses" TO "anon";
GRANT ALL ON TABLE "public"."project_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."project_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."project_phases_with_status" TO "anon";
GRANT ALL ON TABLE "public"."project_phases_with_status" TO "authenticated";
GRANT ALL ON TABLE "public"."project_phases_with_status" TO "service_role";



GRANT ALL ON TABLE "public"."project_progress_view" TO "anon";
GRANT ALL ON TABLE "public"."project_progress_view" TO "authenticated";
GRANT ALL ON TABLE "public"."project_progress_view" TO "service_role";



GRANT ALL ON TABLE "public"."project_templates" TO "anon";
GRANT ALL ON TABLE "public"."project_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_templates" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_log" TO "anon";
GRANT ALL ON TABLE "public"."reminder_log" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_log" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_run_lease" TO "anon";
GRANT ALL ON TABLE "public"."reminder_run_lease" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_run_lease" TO "service_role";



GRANT ALL ON TABLE "public"."sessions_overview" TO "anon";
GRANT ALL ON TABLE "public"."sessions_overview" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions_overview" TO "service_role";



GRANT ALL ON TABLE "public"."template_activities" TO "anon";
GRANT ALL ON TABLE "public"."template_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."template_activities" TO "service_role";



GRANT ALL ON TABLE "public"."template_document_requirements" TO "anon";
GRANT ALL ON TABLE "public"."template_document_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."template_document_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."template_document_attachment_stale_references" TO "anon";
GRANT ALL ON TABLE "public"."template_document_attachment_stale_references" TO "authenticated";
GRANT ALL ON TABLE "public"."template_document_attachment_stale_references" TO "service_role";



GRANT ALL ON TABLE "public"."template_phases" TO "anon";
GRANT ALL ON TABLE "public"."template_phases" TO "authenticated";
GRANT ALL ON TABLE "public"."template_phases" TO "service_role";



GRANT ALL ON TABLE "public"."templates_overview" TO "anon";
GRANT ALL ON TABLE "public"."templates_overview" TO "authenticated";
GRANT ALL ON TABLE "public"."templates_overview" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







