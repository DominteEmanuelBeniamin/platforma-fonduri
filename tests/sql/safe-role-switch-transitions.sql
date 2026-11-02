BEGIN;
SET LOCAL statement_timeout='20s';
DO $test$
DECLARE
  actor uuid := gen_random_uuid();
  first_senior uuid := gen_random_uuid();
  other_senior uuid := gen_random_uuid();
  pending_user uuid := gen_random_uuid();
  project uuid := gen_random_uuid();
  phase uuid := gen_random_uuid();
  activity uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  template uuid := gen_random_uuid();
  template_phase uuid := gen_random_uuid();
  template_activity uuid := gen_random_uuid();
  imported_activity uuid := gen_random_uuid();
  project_status uuid := gen_random_uuid();
  before_audit integer;
BEGIN
  IF has_function_privilege('anon','public.user_role_change_impact(uuid,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.update_user_profile_guarded(uuid,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.update_user_profile_guarded_audited(uuid,uuid,jsonb,text,text)','EXECUTE')
    OR has_function_privilege('service_role','public.update_user_profile_guarded_unchecked(uuid,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.role_switch_impact_internal(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Role RPC privileges expose a bypass';
  END IF;
  INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    SELECT id,'transition-'||id||'@example.invalid','{"full_name":"Transition fixture"}'::jsonb,
      '{"provider":"email","providers":["email"]}'::jsonb
    FROM unnest(ARRAY[actor,first_senior,other_senior,pending_user]) id;
  UPDATE public.profiles SET role='admin',is_active=true,creation_pending=false,full_name='Admin' WHERE id=actor;
  UPDATE public.profiles SET role='consultant',is_active=true,creation_pending=false,full_name='Senior',
    consultant_level='senior',specializare='Test' WHERE id IN (first_senior,other_senior);
  INSERT INTO public.projects(id,title,lifecycle_status) VALUES(project,'Transitions','active');
  INSERT INTO public.project_members(id,project_id,consultant_id) VALUES(member,project,first_senior);
  INSERT INTO public.project_members(project_id,consultant_id) VALUES(project,other_senior);
  BEGIN
    INSERT INTO public.project_members(project_id,consultant_id) VALUES(project,pending_user);
    RAISE EXCEPTION 'Pending replacement must be refused';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT IN ('INELIGIBLE_CONSULTANT','INACTIVE_REFERENCE') THEN RAISE; END IF; END;
  UPDATE public.profiles SET is_active=false WHERE id=other_senior;
  UPDATE public.profiles SET email='invalid-address' WHERE id=first_senior;
  BEGIN
    PERFORM public.update_user_profile_guarded(first_senior,actor,'{"telefon":"123"}');
    RAISE EXCEPTION 'Final profile must validate inherited email';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'EMAIL_INVALID' THEN RAISE; END IF; END;
  UPDATE public.profiles SET email=(SELECT email FROM auth.users WHERE id=first_senior) WHERE id=first_senior;
  SELECT count(*) INTO before_audit FROM public.audit_logs WHERE entity_id=first_senior;
  BEGIN
    PERFORM public.update_user_profile_guarded(first_senior,actor,'{"consultant_level":"junior"}');
    RAISE EXCEPTION 'Inactive alternate senior must not count';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'USER_ROLE_CHANGE_BLOCKED' THEN RAISE; END IF; END;
  IF (SELECT consultant_level FROM public.profiles WHERE id=first_senior)<>'senior'
    OR (SELECT count(*) FROM public.audit_logs WHERE entity_id=first_senior)<>before_audit THEN
    RAISE EXCEPTION 'Blocked role change must not write profile or audit';
  END IF;
  BEGIN
    UPDATE public.project_members SET consultant_id=actor WHERE id=member;
    RAISE EXCEPTION 'Member UPDATE bypassed senior removal guard';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT IN ('PROJECT_SENIOR_REQUIRED','INELIGIBLE_CONSULTANT') THEN RAISE; END IF;
  END;
  INSERT INTO public.project_phases(id,project_id,name,slug,order_index) VALUES(phase,project,'Phase','phase',1);
  INSERT INTO public.project_activities(id,phase_id,name,order_index,assigned_to,visibility)
    VALUES(activity,phase,'Published responsibility',1,first_senior,'published');
  BEGIN
    UPDATE public.project_activities SET assigned_to=NULL WHERE id=activity;
    RAISE EXCEPTION 'Published activity must retain an eligible owner';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'INELIGIBLE_CONSULTANT' THEN RAISE; END IF; END;
  UPDATE public.projects SET lifecycle_status='completed',closed_at=clock_timestamp(),closed_by=actor WHERE id=project;
  PERFORM public.update_user_profile_guarded(first_senior,actor,'{"role":"admin"}');
  BEGIN
    UPDATE public.projects SET lifecycle_status='active',closed_at=NULL,closed_by=NULL WHERE id=project;
    RAISE EXCEPTION 'Project reopening without senior must fail';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'PROJECT_SENIOR_REQUIRED' THEN RAISE; END IF; END;
  UPDATE public.profiles SET is_active=true WHERE id=other_senior;
  BEGIN
    UPDATE public.projects SET lifecycle_status='active',closed_at=NULL,closed_by=NULL WHERE id=project;
    RAISE EXCEPTION 'Project reopening with invalid responsibility must fail';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'USER_ROLE_CHANGE_BLOCKED' THEN RAISE; END IF; END;
  -- The narrowly allowed repair changes only ownership while the project stays closed.
  UPDATE public.project_activities SET assigned_to=other_senior WHERE id=activity;
  IF (SELECT lifecycle_status FROM public.projects WHERE id=project)<>'completed' THEN
    RAISE EXCEPTION 'Preparing ownership must not reopen the project';
  END IF;
  UPDATE public.projects SET lifecycle_status='active',closed_at=NULL,closed_by=NULL WHERE id=project;
  UPDATE public.project_activities SET status='completed',completed_at=clock_timestamp(),completed_by=actor WHERE id=activity;
  UPDATE public.project_phases SET status='completed',completed_at=clock_timestamp(),completed_by=actor WHERE id=phase;
  UPDATE public.project_phases SET status='pending',completed_at=NULL,completed_by=NULL WHERE id=phase;
  IF (SELECT completed_by FROM public.project_activities WHERE id=activity) IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Reopening a phase must retain activity completion history';
  END IF;
  INSERT INTO public.project_statuses(id,name,slug) VALUES(project_status,'Import status','import-'||project_status);
  INSERT INTO public.project_templates(id,name,slug,is_active,status)
    VALUES(template,'Import '||template,'import-'||template,true,'published');
  INSERT INTO public.template_phases(id,template_id,project_status_id,name,slug)
    VALUES(template_phase,template,project_status,'Import phase','import');
  INSERT INTO public.template_activities(id,template_phase_id,name)
    VALUES(template_activity,template_phase,'Import activity');
  INSERT INTO public.project_activities(id,phase_id,name,order_index,visibility,source_template_activity_id)
    VALUES(imported_activity,phase,'Import draft',2,'draft',template_activity);
  BEGIN
    PERFORM public.finalize_template_import(p_project_id=>project,p_template_id=>template,p_first_status_id=>project_status,p_actor_id=>actor,
      p_assignments=>jsonb_build_array(jsonb_build_object('activity_id',imported_activity,'template_activity_id',template_activity,
        'consultant_id',first_senior,'explicit',true)));
    RAISE EXCEPTION 'Import must refuse a consultant who became admin';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'INACTIVE_ASSIGNMENT' THEN RAISE; END IF; END;
  IF (SELECT template_id FROM public.projects WHERE id=project) IS NOT NULL
    OR (SELECT assigned_to FROM public.project_activities WHERE id=imported_activity) IS NOT NULL THEN
    RAISE EXCEPTION 'Refused import must not save partial assignments';
  END IF;
  PERFORM public.finalize_template_import(p_project_id=>project,p_template_id=>template,p_first_status_id=>project_status,p_actor_id=>actor,
    p_assignments=>jsonb_build_array(jsonb_build_object('activity_id',imported_activity,'template_activity_id',template_activity,
      'consultant_id',other_senior,'explicit',true)));
  IF (SELECT template_id FROM public.projects WHERE id=project) IS DISTINCT FROM template
    OR (SELECT assigned_to FROM public.project_activities WHERE id=imported_activity) IS DISTINCT FROM other_senior THEN
    RAISE EXCEPTION 'Eligible import must retain explicit assignments';
  END IF;
END
$test$;
ROLLBACK;
