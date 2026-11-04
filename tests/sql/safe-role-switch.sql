BEGIN;
SET LOCAL statement_timeout='20s';
DO $test$
DECLARE
  admin_id uuid := 'f0000000-0000-4000-8000-000000000001';
  junior_id uuid := 'f0000000-0000-4000-8000-000000000002';
  senior_id uuid := 'f0000000-0000-4000-8000-000000000003';
  senior2_id uuid := 'f0000000-0000-4000-8000-000000000004';
  client_id uuid := 'f0000000-0000-4000-8000-000000000005';
  project_id uuid := 'f1000000-0000-4000-8000-000000000001';
  phase_id uuid := 'f2000000-0000-4000-8000-000000000001';
  activity_id uuid := 'f3000000-0000-4000-8000-000000000001';
  member_id uuid := 'f4000000-0000-4000-8000-000000000001';
  request_id uuid := 'f5000000-0000-4000-8000-000000000001';
  template_id uuid := 'f6000000-0000-4000-8000-000000000001';
  template_phase_id uuid := 'f7000000-0000-4000-8000-000000000001';
  template_activity_id uuid := 'f8000000-0000-4000-8000-000000000001';
  status_id uuid := 'f9000000-0000-4000-8000-000000000001';
  result jsonb;
  audit_count integer;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
  SELECT id,'role-test-'||id||'@example.invalid','{"full_name":"Role fixture"}'::jsonb,'{"provider":"email","providers":["email"]}'::jsonb
  FROM unnest(ARRAY[admin_id,junior_id,senior_id,senior2_id,client_id]) id;
  -- New accounts start pending; this exercises the canonical creation transition.
  UPDATE public.profiles SET role='admin',creation_pending=false,is_active=true,full_name='Admin' WHERE id=admin_id;
  UPDATE public.profiles SET role='consultant',creation_pending=false,is_active=true,full_name='Junior',specializare='Test',consultant_level='junior' WHERE id=junior_id;
  UPDATE public.profiles SET role='consultant',creation_pending=false,is_active=true,full_name='Senior',specializare='Test',consultant_level='senior' WHERE id=senior_id;
  UPDATE public.profiles SET role='consultant',creation_pending=false,is_active=true,full_name='Senior 2',specializare='Test',consultant_level='senior' WHERE id=senior2_id;
  UPDATE public.profiles SET role='client',creation_pending=false,is_active=true,full_name='Client',cif='RO5258486',nume_firma='Firma',adresa_firma='Adresa' WHERE id=client_id;
  SELECT count(*) INTO audit_count FROM public.audit_logs WHERE entity_id=junior_id;
  PERFORM public.update_user_profile_guarded(junior_id,admin_id,'{"role":"admin"}'::jsonb);
  IF (SELECT role FROM public.profiles WHERE id=junior_id)<>'admin' OR (SELECT count(*) FROM public.audit_logs WHERE entity_id=junior_id)<>audit_count+1 THEN
    RAISE EXCEPTION 'Junior promotion and atomic audit failed';
  END IF;
  BEGIN
    PERFORM public.update_user_profile_guarded(junior_id,admin_id,'{"role":"consultant"}'::jsonb);
    RAISE EXCEPTION 'Expected explicit level requirement';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'PROFILE_FIELD_REQUIRED' THEN RAISE; END IF; END;
  PERFORM public.update_user_profile_guarded(junior_id,admin_id,'{"role":"consultant","consultant_level":"junior"}'::jsonb);
  PERFORM public.update_user_profile_guarded(client_id,admin_id,'{"role":"client"}'::jsonb);
  BEGIN
    PERFORM public.update_user_profile_guarded(client_id,admin_id,'{"role":"admin"}'::jsonb);
    RAISE EXCEPTION 'Expected client conversion refusal';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ROLE_CONVERSION_FORBIDDEN' THEN RAISE; END IF; END;
  result:=public.user_role_change_impact(admin_id,admin_id,'{"role":"consultant","consultant_level":"junior"}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='last_admin') THEN
    RAISE EXCEPTION 'Last admin missing from impact';
  END IF;
  BEGIN
    PERFORM public.update_user_profile_guarded(admin_id,admin_id,'{"role":"consultant","consultant_level":"junior","specializare":"Test"}'::jsonb);
    RAISE EXCEPTION 'Expected last admin refusal';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'LAST_ACTIVE_ADMIN' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.user_role_change_impact(junior_id,junior_id,'{"role":"admin"}'::jsonb);
    RAISE EXCEPTION 'Expected admin authorization';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ACTIVE_ADMIN_REQUIRED' THEN RAISE; END IF; END;
  UPDATE public.profiles SET full_name='' WHERE id=junior_id;
  BEGIN
    PERFORM public.update_user_profile_guarded(junior_id,admin_id,'{"telefon":"123"}'::jsonb);
    RAISE EXCEPTION 'Expected full profile validation';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'PROFILE_FIELD_REQUIRED' THEN RAISE; END IF; END;
  UPDATE public.profiles SET full_name='Junior' WHERE id=junior_id;
  INSERT INTO public.projects(id,title,lifecycle_status) VALUES(project_id,'Role project','active');
  INSERT INTO public.project_members(id,project_id,consultant_id) VALUES(member_id,project_id,senior_id),(gen_random_uuid(),project_id,junior_id);
  INSERT INTO public.project_phases(id,project_id,name,slug,order_index) VALUES(phase_id,project_id,'Phase','phase',1);
  INSERT INTO public.project_activities(id,phase_id,name,order_index,assigned_to,visibility) VALUES(activity_id,phase_id,'Draft',1,junior_id,'draft');
  INSERT INTO public.document_requirements(id,project_id,activity_id,name,requirement_type,status,visibility)
    VALUES(request_id,project_id,activity_id,'Review','optional','review','published');
  INSERT INTO public.project_statuses(id,name,slug) VALUES(status_id,'Role status','role-test-status');
  INSERT INTO public.project_templates(id,name,slug,is_active) VALUES(template_id,'Role template','role-test-template',true);
  INSERT INTO public.template_phases(id,template_id,project_status_id,name,slug) VALUES(template_phase_id,template_id,status_id,'Phase','phase');
  INSERT INTO public.template_activities(id,template_phase_id,name,default_consultant_id) VALUES(template_activity_id,template_phase_id,'Template activity',junior_id);
  result:=public.user_role_change_impact(junior_id,admin_id,'{"role":"admin"}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='request' AND x->>'source'='activity') THEN RAISE EXCEPTION 'Inherited review missing from impact'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='template') THEN RAISE EXCEPTION 'Template assignment missing from impact'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='request'
    AND x->>'url'='/projects/'||project_id||'?phase='||phase_id||'&activity='||activity_id||'&document='||request_id) THEN
    RAISE EXCEPTION 'Remediation link must reveal and open the affected request';
  END IF;
  BEGIN
    UPDATE public.project_activities SET assigned_to=NULL WHERE id=activity_id;
    RAISE EXCEPTION 'Expected inherited published request guard';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'INELIGIBLE_CONSULTANT' THEN RAISE; END IF; END;
  UPDATE public.document_requirements SET assigned_to=senior_id WHERE id=request_id;
  UPDATE public.template_activities SET default_consultant_id=NULL WHERE id=template_activity_id;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='activity') THEN RAISE EXCEPTION 'Draft missing from impact'; END IF;
  BEGIN
    PERFORM public.update_user_profile_guarded(junior_id,admin_id,'{"role":"admin"}'::jsonb);
    RAISE EXCEPTION 'Expected assigned activity refusal';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'USER_ROLE_CHANGE_BLOCKED' THEN RAISE; END IF; END;
  UPDATE public.project_activities SET assigned_to=NULL WHERE id=activity_id;
  PERFORM public.update_user_profile_guarded(junior_id,admin_id,'{"role":"admin"}'::jsonb);
  BEGIN
    PERFORM public.remove_project_member_if_unassigned(project_id,member_id);
    RAISE EXCEPTION 'Expected last senior refusal';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'PROJECT_SENIOR_REQUIRED' THEN RAISE; END IF; END;
  INSERT INTO public.project_members(project_id,consultant_id) VALUES(project_id,senior2_id);
  UPDATE public.document_requirements SET assigned_to=senior2_id WHERE id=request_id;
  UPDATE public.project_templates SET is_active=false WHERE id=template_id;
  UPDATE public.template_activities SET default_consultant_id=senior_id WHERE id=template_activity_id;
  result:=public.user_role_change_impact(senior_id,admin_id,'{"role":"admin"}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'information') x WHERE x->>'kind'='inactive_template') THEN
    RAISE EXCEPTION 'Inactive template reference missing from information';
  END IF;
  PERFORM public.update_user_profile_guarded(senior_id,admin_id,'{"role":"admin"}'::jsonb);
  IF (SELECT role FROM public.profiles WHERE id=senior_id)<>'admin' THEN RAISE EXCEPTION 'Senior promotion failed'; END IF;
  BEGIN
    UPDATE public.project_templates SET is_active=true WHERE id=template_id;
    RAISE EXCEPTION 'Expected inactive template revalidation';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'INELIGIBLE_CONSULTANT' THEN RAISE; END IF; END;
  PERFORM public.update_user_profile_guarded(senior_id,admin_id,'{"role":"consultant","consultant_level":"senior"}'::jsonb);
  IF (SELECT consultant_level FROM public.profiles WHERE id=senior_id)<>'senior' THEN RAISE EXCEPTION 'Explicit senior level not retained'; END IF;
  UPDATE public.document_requirements SET assigned_to=senior_id WHERE id=request_id;
  UPDATE public.project_activities SET assigned_to=senior_id,status='completed',completed_at=clock_timestamp(),completed_by=admin_id WHERE id=activity_id;
  result:=public.user_role_change_impact(senior_id,admin_id,'{"role":"admin"}'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='activity') OR
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='request') THEN
    RAISE EXCEPTION 'Completed activity must be historical while its open request remains a blocker';
  END IF;
  UPDATE public.document_requirements SET status='approved' WHERE id=request_id;
  PERFORM public.update_user_profile_guarded(senior_id,admin_id,'{"role":"admin"}'::jsonb);
  BEGIN
    UPDATE public.project_activities SET status='pending',completed_at=NULL,completed_by=NULL WHERE id=activity_id;
    RAISE EXCEPTION 'Expected reopening eligibility guard';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'USER_ROLE_CHANGE_BLOCKED' THEN RAISE; END IF; END;
END
$test$;
ROLLBACK;
