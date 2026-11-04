BEGIN;
DO $test$
DECLARE
  target uuid := 'fa000000-0000-4000-8000-000000000001';
  project uuid := 'fa000000-0000-4000-8000-000000000002';
  phase uuid := 'fa000000-0000-4000-8000-000000000003';
  activity uuid := 'fa000000-0000-4000-8000-000000000004';
  request uuid := 'fa000000-0000-4000-8000-000000000005';
  general_request uuid := 'fa000000-0000-4000-8000-000000000006';
  result jsonb;
  request_url text;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
  VALUES(target,'role-links@example.invalid','{"full_name":"Role links"}','{"provider":"email","providers":["email"]}');
  UPDATE public.profiles SET role='consultant',creation_pending=false,is_active=true,full_name='Role links',specializare='Test',consultant_level='senior' WHERE id=target;
  INSERT INTO public.projects(id,title,lifecycle_status) VALUES(project,'Role links','active');
  INSERT INTO public.project_members(project_id,consultant_id) VALUES(project,target);
  UPDATE public.projects SET general_consultant_id=target WHERE id=project;
  INSERT INTO public.project_phases(id,project_id,name,slug,order_index) VALUES(phase,project,'Phase','phase',1);
  INSERT INTO public.project_activities(id,phase_id,name,order_index,assigned_to,visibility) VALUES(activity,phase,'Activity',1,target,'draft');
  INSERT INTO public.document_requirements(id,project_id,activity_id,name,requirement_type,status,visibility)
  VALUES(request,project,activity,'Request','optional','pending','draft'),(general_request,project,NULL,'General request','optional','pending','draft');
  INSERT INTO public.document_request_reviews(requirement_id,action,reviewed_version_number,reviewed_by) VALUES(request,'approved',1,target);
  INSERT INTO public.files(requirement_id,storage_path,original_name,uploaded_by) VALUES(request,'role-links/path','test.pdf',target);
  result:=public.role_switch_impact_internal(target,'{"role":"admin"}');
  request_url:='/projects/'||project||'?phase='||phase||'&activity='||activity||'&document='||request;
  IF (SELECT count(*) FROM jsonb_array_elements(result->'information') x WHERE x->>'kind' IN ('historical_review','historical_upload') AND x->>'url'=request_url)<>2 THEN
    RAISE EXCEPTION 'Review and upload must link to their request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='request' AND x->>'url'='/projects/'||project||'?phase=__general__&document='||general_request)
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='general_consultant' AND x->>'url'='/projects/'||project||'?phase=__general__&general_consultant=1')
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'blockers') x WHERE x->>'kind'='senior' AND x->>'url'='/projects/'||project||'?team=1')
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'information') x WHERE x->>'kind'='membership' AND x->>'url'='/projects/'||project||'?team=1') THEN
    RAISE EXCEPTION 'General request, consultant, or team link is incorrect';
  END IF;
  UPDATE public.project_activities SET status='completed',completed_at=clock_timestamp(),completed_by=target WHERE id=activity;
  result:=public.role_switch_impact_internal(target,'{"role":"admin"}');
  IF (SELECT count(*) FROM jsonb_array_elements(result->'information') x WHERE x->>'kind' IN ('historical_activity','historical_activity_closer')
    AND x->>'url'='/projects/'||project||'?phase='||phase||'&activity='||activity)<>2 THEN
    RAISE EXCEPTION 'Historical activity links are incorrect';
  END IF;
END $test$;
ROLLBACK;
