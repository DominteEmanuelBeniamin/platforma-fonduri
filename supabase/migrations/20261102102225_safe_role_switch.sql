CREATE OR REPLACE FUNCTION public.role_switch_impact_internal(p_target_id uuid, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  t public.profiles%ROWTYPE;

  resulting_role text;
  resulting_level text;
  resulting_active boolean;
  loses_consultant boolean;
  loses_senior boolean;
  blockers jsonb;
  information jsonb;
  warnings jsonb := '[]'::jsonb;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb
    OR p_changes - ARRAY['role','consultant_level','is_active']::text[] <> '{}'::jsonb
    OR (p_changes ? 'role' AND coalesce(p_changes->>'role','') NOT IN ('admin','consultant'))
    OR (p_changes ? 'consultant_level' AND coalesce(p_changes->>'consultant_level','') NOT IN ('junior','senior'))
    OR (p_changes ? 'is_active' AND jsonb_typeof(p_changes->'is_active') <> 'boolean') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVALID_PROFILE_PATCH';
  END IF;
  SELECT * INTO t FROM public.profiles WHERE id=p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='USER_NOT_FOUND'; END IF;
  IF t.creation_pending IS TRUE THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ACCOUNT_CREATION_PENDING'; END IF;
  resulting_role := coalesce(p_changes->>'role',t.role);
  resulting_level := coalesce(p_changes->>'consultant_level',t.consultant_level);
  resulting_active := coalesce((p_changes->>'is_active')::boolean,t.is_active);
  IF resulting_role IS DISTINCT FROM t.role AND (t.role='client' OR resulting_role='client') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ROLE_CONVERSION_FORBIDDEN';
  END IF;
  loses_consultant := t.role='consultant' AND (resulting_role <> 'consultant' OR resulting_active IS NOT TRUE);
  loses_senior := t.role='consultant' AND t.consultant_level='senior' AND t.is_active IS TRUE
    AND (resulting_role <> 'consultant' OR resulting_active IS NOT TRUE OR resulting_level <> 'senior');
  WITH items AS (
    SELECT true AS blocked, jsonb_build_object('id',t.id,'kind','last_admin','title','Ultimul administrator activ',
      'reason','Adaugă alt administrator activ înainte de această operațiune.') AS item
    WHERE t.role='admin' AND t.is_active IS TRUE AND (resulting_role<>'admin' OR resulting_active IS NOT TRUE)
      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id<>t.id AND p.role='admin' AND p.is_active IS TRUE AND p.creation_pending IS NOT TRUE)
    UNION ALL
    SELECT true AS blocked, jsonb_build_object('id',p.id,'kind','general_consultant','title',p.title,
      'reason','Înlocuiește consultantul general.','project_id',p.id,'project_name',p.title,'state',p.lifecycle_status,'url','/projects/'||p.id) AS item
    FROM public.projects p WHERE loses_consultant AND p.general_consultant_id=t.id AND p.lifecycle_status='active'
    UNION ALL
    SELECT true,jsonb_build_object('id',a.id,'kind','activity','title',a.name,
      'reason',CASE WHEN a.visibility='draft' THEN 'Înlocuiește sau elimină atribuirea.' ELSE 'Înlocuiește responsabilul.' END,
      'project_id',p.id,'project_name',p.title,'state',a.status,'source',a.visibility,
      'url','/projects/'||p.id||'?phase='||ph.id||'&activity='||a.id)
    FROM public.project_activities a JOIN public.project_phases ph ON ph.id=a.phase_id JOIN public.projects p ON p.id=ph.project_id
    WHERE loses_consultant AND a.assigned_to=t.id AND p.lifecycle_status='active' AND a.status<>'completed'
    UNION ALL
    SELECT true,jsonb_build_object('id',d.id,'kind','request','title',coalesce(d.name,'Cerere de documente'),'reason','Predă responsabilitatea cererii.',
      'project_id',p.id,'project_name',p.title,'state',d.status,
      'source',CASE WHEN d.assigned_to IS NOT NULL THEN 'direct' WHEN a.assigned_to IS NOT NULL THEN 'activity' ELSE 'general_consultant' END,
      'url','/projects/'||p.id||'?phase='||coalesce(a.phase_id::text,'__general__')
        ||CASE WHEN a.id IS NOT NULL THEN '&activity='||a.id ELSE '' END||'&document='||d.id)
    FROM public.document_requirements d JOIN public.projects p ON p.id=d.project_id
    LEFT JOIN public.project_activities a ON a.id=d.activity_id
    WHERE loses_consultant AND p.lifecycle_status='active' AND d.deleted_at IS NULL AND NOT d.is_outgoing
      AND coalesce(d.status,'pending') NOT IN ('approved','closed') AND coalesce(d.assigned_to,CASE WHEN d.activity_id IS NOT NULL THEN a.assigned_to ELSE p.general_consultant_id END)=t.id
    UNION ALL
    SELECT true,jsonb_build_object('id',p.id,'kind','senior','title',p.title,'reason','Adaugă alt senior activ în echipă.',
      'project_id',p.id,'project_name',p.title,'state',p.lifecycle_status,'url','/projects/'||p.id)
    FROM public.projects p JOIN public.project_members m ON m.project_id=p.id AND m.consultant_id=t.id
    WHERE loses_senior AND p.lifecycle_status='active' AND NOT EXISTS (
      SELECT 1 FROM public.project_members m2 JOIN public.profiles p2 ON p2.id=m2.consultant_id
      WHERE m2.project_id=p.id AND p2.id<>t.id AND p2.role='consultant' AND p2.consultant_level='senior'
        AND p2.is_active IS TRUE AND p2.creation_pending IS NOT TRUE)
    UNION ALL
    SELECT true,jsonb_build_object('id',a.id,'kind','template','title',a.name,'reason','Înlocuiește sau elimină atribuirea implicită.',
      'template_id',pt.id,'template_name',pt.name,'state',pt.status,'url','/admin/templates?edit='||pt.id)
    FROM public.template_activities a JOIN public.template_phases ph ON ph.id=a.template_phase_id JOIN public.project_templates pt ON pt.id=ph.template_id
    WHERE loses_consultant AND a.default_consultant_id=t.id AND a.is_active IS TRUE AND ph.is_active IS TRUE AND pt.is_active IS TRUE
    UNION ALL
    SELECT false,jsonb_build_object('id',a.id,'kind','inactive_template','title',a.name,'reason','Atribuire într-un șablon neutilizabil.',
      'template_id',pt.id,'template_name',pt.name,'state',pt.status,'url','/admin/templates?edit='||pt.id)
    FROM public.template_activities a JOIN public.template_phases ph ON ph.id=a.template_phase_id JOIN public.project_templates pt ON pt.id=ph.template_id
    WHERE a.default_consultant_id=t.id AND (a.is_active IS NOT TRUE OR ph.is_active IS NOT TRUE OR pt.is_active IS NOT TRUE)
    UNION ALL
    SELECT false,jsonb_build_object('id',t.id,'kind','legacy_client_data','title','Date de client păstrate',
      'reason','Contul intern are date de client existente; acestea nu sunt șterse automat.')
    WHERE t.role IN ('admin','consultant') AND (t.cif IS NOT NULL OR t.nume_firma IS NOT NULL OR t.adresa_firma IS NOT NULL)
    UNION ALL
    SELECT false,jsonb_build_object('id',p.id,'kind','legacy_client_project','title',p.title,
      'reason','Contul intern este titularul existent al acestui proiect.',
      'project_id',p.id,'project_name',p.title,'state',p.lifecycle_status,'url','/projects/'||p.id)
    FROM public.projects p WHERE t.role IN ('admin','consultant') AND p.client_id=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',m.id,'kind','membership','title',p.title,'reason','Apartenența la echipă se păstrează.',
      'project_id',p.id,'project_name',p.title,'state',p.lifecycle_status,'url','/projects/'||p.id)
    FROM public.project_members m JOIN public.projects p ON p.id=m.project_id WHERE m.consultant_id=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',p.id,'kind','historical_project_closer','title',p.title,'reason','Autorul încheierii rămâne neschimbat.',
      'project_id',p.id,'project_name',p.title,'url','/projects/'||p.id)
    FROM public.projects p WHERE p.closed_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',ph.id,'kind','historical_phase_closer','title',ph.name,'reason','Autorul finalizării rămâne neschimbat.',
      'project_id',p.id,'project_name',p.title,'url','/projects/'||p.id)
    FROM public.project_phases ph JOIN public.projects p ON p.id=ph.project_id WHERE ph.completed_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',a.id,'kind','historical_activity_closer','title',a.name,'reason','Autorul finalizării rămâne neschimbat.',
      'project_id',p.id,'project_name',p.title,'url','/projects/'||p.id)
    FROM public.project_activities a JOIN public.project_phases ph ON ph.id=a.phase_id JOIN public.projects p ON p.id=ph.project_id WHERE a.completed_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',r.id,'kind','historical_review','title',coalesce(d.name,'Cerere de documente'),
      'reason','Autorul verificării rămâne neschimbat.','project_id',p.id,'project_name',p.title,'url','/projects/'||p.id)
    FROM public.document_request_reviews r JOIN public.document_requirements d ON d.id=r.requirement_id JOIN public.projects p ON p.id=d.project_id WHERE r.reviewed_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',f.id,'kind','historical_upload','title',coalesce(d.name,'Cerere de documente'),
      'reason','Autorul încărcării rămâne neschimbat.','project_id',p.id,'project_name',p.title,'url','/projects/'||p.id)
    FROM public.files f JOIN public.document_requirements d ON d.id=f.requirement_id JOIN public.projects p ON p.id=d.project_id WHERE f.uploaded_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',a.id,'kind','historical_activity','title',a.name,'reason','Responsabilitate istorică.',
      'project_id',p.id,'project_name',p.title,'state',a.status,'url','/projects/'||p.id)
    FROM public.project_activities a JOIN public.project_phases ph ON ph.id=a.phase_id JOIN public.projects p ON p.id=ph.project_id
    WHERE a.assigned_to=t.id AND (p.lifecycle_status<>'active' OR a.status='completed')
    UNION ALL
    SELECT false,jsonb_build_object('id',d.id,'kind','historical_request','title',coalesce(d.name,'Cerere de documente'),'reason','Responsabilitate istorică.',
      'project_id',p.id,'project_name',p.title,'state',d.status,'url','/projects/'||p.id)
    FROM public.document_requirements d JOIN public.projects p ON p.id=d.project_id LEFT JOIN public.project_activities a ON a.id=d.activity_id
    WHERE d.deleted_at IS NULL AND coalesce(d.assigned_to,CASE WHEN d.activity_id IS NOT NULL THEN a.assigned_to ELSE p.general_consultant_id END)=t.id
      AND (p.lifecycle_status<>'active' OR d.status IN ('approved','closed'))
  )
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'kind',item->>'id') FILTER (WHERE blocked),'[]'::jsonb),
         coalesce(jsonb_agg(item ORDER BY item->>'kind',item->>'id') FILTER (WHERE NOT blocked),'[]'::jsonb)
    INTO blockers,information FROM items;
  IF loses_senior AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id<>t.id AND p.role='consultant'
      AND p.consultant_level='senior' AND p.is_active IS TRUE AND p.creation_pending IS NOT TRUE) THEN
    warnings := jsonb_build_array('Nu va mai exista niciun consultant senior activ.');
  END IF;
  RETURN jsonb_build_object('target_id',t.id,'changes',p_changes,'checked_at',clock_timestamp(),
    'blockers',blockers,'information',information,'totals',jsonb_build_object('blockers',jsonb_array_length(blockers),'information',jsonb_array_length(information)),
    'warnings',warnings);
END $$;
REVOKE ALL ON FUNCTION public.role_switch_impact_internal(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.user_role_change_impact(p_target_id uuid,p_actor_id uuid,p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role='admin' AND is_active IS TRUE AND creation_pending IS NOT TRUE) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ACTIVE_ADMIN_REQUIRED';
  END IF;
  RETURN public.role_switch_impact_internal(p_target_id,p_changes);
END $$;
REVOKE ALL ON FUNCTION public.user_role_change_impact(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.user_role_change_impact(uuid,uuid,jsonb) TO service_role;

-- This guard also covers deactivation and direct privileged profile writes.
CREATE OR REPLACE FUNCTION public.guard_role_responsibilities()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE impact jsonb; changes jsonb := '{}'::jsonb;
BEGIN
  IF OLD.creation_pending IS TRUE THEN RETURN NEW; END IF;
  IF NEW.role IS NOT DISTINCT FROM OLD.role AND NEW.consultant_level IS NOT DISTINCT FROM OLD.consultant_level
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF OLD.role NOT IN ('admin','consultant') OR NEW.role NOT IN ('admin','consultant') THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ROLE_CONVERSION_FORBIDDEN';
    END IF;
    changes := changes || jsonb_build_object('role',NEW.role);
    IF nullif(btrim(NEW.full_name),'') IS NULL OR nullif(btrim(NEW.email),'') IS NULL
       OR (NEW.role='consultant' AND nullif(btrim(NEW.specializare),'') IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PROFILE_FIELD_REQUIRED';
    END IF;
  END IF;
  IF NEW.role='consultant' AND NEW.consultant_level IS DISTINCT FROM OLD.consultant_level THEN
    changes := changes || jsonb_build_object('consultant_level',NEW.consultant_level);
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN changes := changes || jsonb_build_object('is_active',NEW.is_active); END IF;
  impact := public.role_switch_impact_internal(OLD.id,changes);
  IF jsonb_array_length(impact->'blockers')>0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='USER_ROLE_CHANGE_BLOCKED', DETAIL=impact::text;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_role_responsibilities() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_role_responsibilities BEFORE UPDATE OF role,consultant_level,is_active ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_role_responsibilities();

ALTER FUNCTION public.update_user_profile_guarded(uuid,uuid,jsonb) RENAME TO update_user_profile_guarded_unchecked;
REVOKE ALL ON FUNCTION public.update_user_profile_guarded_unchecked(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.update_user_profile_guarded_audited(p_target_id uuid,p_actor_id uuid,p_changes jsonb,p_ip_address text,p_user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; target public.profiles%ROWTYPE; resulting_profile jsonb;
BEGIN
  IF p_target_id IS NULL OR p_actor_id IS NULL OR p_changes IS NULL OR jsonb_typeof(p_changes)<>'object'
    OR p_changes='{}'::jsonb OR p_changes - ARRAY['full_name','role','telefon','cif','consultant_level','email','nume_firma','adresa_firma','departament','specializare']::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVALID_PROFILE_PATCH';
  END IF;
  PERFORM pg_advisory_xact_lock(105,1);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND role='admin' AND is_active IS TRUE AND creation_pending IS NOT TRUE) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ACTIVE_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO target FROM public.profiles WHERE id=p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='USER_NOT_FOUND'; END IF;
  IF target.creation_pending IS TRUE THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ACCOUNT_CREATION_PENDING'; END IF;
  resulting_profile := to_jsonb(target) || p_changes;
  IF coalesce(resulting_profile->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(resulting_profile->>'email')>254 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='EMAIL_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each_text(resulting_profile) f WHERE length(btrim(f.value))>300
    AND (f.key IN ('full_name','telefon','email')
      OR (resulting_profile->>'role'='client' AND f.key IN ('nume_firma','adresa_firma'))
      OR (resulting_profile->>'role' IN ('admin','consultant') AND f.key='departament')
      OR (resulting_profile->>'role'='consultant' AND f.key='specializare'))) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVALID_PROFILE_PATCH';
  END IF;
  IF nullif(btrim(coalesce(p_changes->>'full_name',target.full_name)),'') IS NULL
    OR nullif(btrim(coalesce(p_changes->>'email',target.email)),'') IS NULL
    OR (coalesce(p_changes->>'role',target.role)='consultant' AND nullif(btrim(coalesce(p_changes->>'specializare',target.specializare)),'') IS NULL)
    OR (coalesce(p_changes->>'role',target.role)='client' AND (nullif(btrim(coalesce(p_changes->>'nume_firma',target.nume_firma)),'') IS NULL OR nullif(btrim(coalesce(p_changes->>'adresa_firma',target.adresa_firma)),'') IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PROFILE_FIELD_REQUIRED';
  END IF;
  IF p_changes ? 'role' AND p_changes->>'role'='consultant' AND target.role='admin'
      AND (NOT p_changes ? 'consultant_level' OR p_changes->>'consultant_level' NOT IN ('junior','senior')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PROFILE_FIELD_REQUIRED';
  END IF;
  result := public.update_user_profile_guarded_unchecked(p_target_id,p_actor_id,p_changes);
  IF (result->>'changed')::boolean THEN
    INSERT INTO public.audit_logs(user_id,action_type,entity_type,entity_id,entity_name,old_values,new_values,description,ip_address,user_agent)
    VALUES(p_actor_id,'update','user',p_target_id,coalesce(result->'profile'->>'email',target.email),result->'oldValues',result->'newValues',
      CASE WHEN result->'newValues' ? 'role' THEN 'Administratorul a schimbat rolul contului.'
           WHEN result->'newValues' ? 'consultant_level' THEN 'Administratorul a schimbat nivelul consultantului.'
           WHEN result->'newValues' ? 'email' THEN 'Administratorul a schimbat emailul contului.'
           ELSE 'Administratorul a modificat datele contului.' END,
      left(coalesce(p_ip_address,'unknown'),128),left(coalesce(p_user_agent,'unknown'),512));
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.update_user_profile_guarded_audited(uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_profile_guarded_audited(uuid,uuid,jsonb,text,text) TO service_role;
CREATE FUNCTION public.update_user_profile_guarded(p_target_id uuid,p_actor_id uuid,p_changes jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT public.update_user_profile_guarded_audited(p_target_id,p_actor_id,p_changes,NULL,NULL)
$$;
REVOKE ALL ON FUNCTION public.update_user_profile_guarded(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_profile_guarded(uuid,uuid,jsonb) TO service_role;


-- Serialize project/team/template changes against one another as well as account changes.
-- Take the existing account lock first to avoid upgrading it in import functions.
CREATE OR REPLACE FUNCTION public.role_switch_serialize_reference_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(105,1);
  PERFORM pg_advisory_xact_lock(105,2);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.role_switch_serialize_reference_write() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['projects','project_members','project_phases','project_activities','document_requirements','project_templates','template_phases','template_activities'] LOOP
    EXECUTE format('CREATE TRIGGER z_role_switch_serialize BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.role_switch_serialize_reference_write()',tab);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.role_switch_eligible(p_user uuid,p_project uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_user AND p.role='consultant'
    AND p.is_active IS TRUE AND p.creation_pending IS NOT TRUE
    AND (p_project IS NULL OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id=p_project AND m.consultant_id=p.id)))
$$;
REVOKE ALL ON FUNCTION public.role_switch_eligible(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.role_switch_project_senior(p_project uuid,p_exclude uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members m JOIN public.profiles p ON p.id=m.consultant_id
    WHERE m.project_id=p_project AND (p_exclude IS NULL OR p.id<>p_exclude)
      AND p.role='consultant' AND p.consultant_level='senior' AND p.is_active IS TRUE AND p.creation_pending IS NOT TRUE)
$$;
REVOKE ALL ON FUNCTION public.role_switch_project_senior(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.role_switch_guard_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who uuid; project uuid;
BEGIN
  IF TG_TABLE_NAME='project_members' THEN
    who:=NEW.consultant_id; project:=NULL;
    IF TG_OP='UPDATE' AND NEW.consultant_id IS NOT DISTINCT FROM OLD.consultant_id AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='projects' THEN
    who:=NEW.general_consultant_id;
    project:=CASE WHEN TG_OP='UPDATE' THEN NEW.id ELSE NULL END;
    IF TG_OP='UPDATE' AND NEW.general_consultant_id IS NOT DISTINCT FROM OLD.general_consultant_id THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='project_activities' THEN
    who:=NEW.assigned_to;
    SELECT project_id INTO project FROM public.project_phases WHERE id=NEW.phase_id;
    IF TG_OP='UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to AND NEW.phase_id IS NOT DISTINCT FROM OLD.phase_id THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='document_requirements' THEN
    who:=NEW.assigned_to; project:=NEW.project_id;
    IF TG_OP='UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NEW; END IF;
  ELSE
    who:=NEW.default_consultant_id; project:=NULL;
    IF TG_OP='UPDATE' AND NEW.default_consultant_id IS NOT DISTINCT FROM OLD.default_consultant_id THEN RETURN NEW; END IF;
  END IF;
  IF who IS NOT NULL AND NOT public.role_switch_eligible(who,project) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INELIGIBLE_CONSULTANT';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.role_switch_guard_reference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER role_switch_guard_reference BEFORE INSERT OR UPDATE OF consultant_id,project_id ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reference();
CREATE TRIGGER role_switch_guard_reference BEFORE INSERT OR UPDATE OF general_consultant_id ON public.projects FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reference();
CREATE TRIGGER role_switch_guard_reference BEFORE INSERT OR UPDATE OF assigned_to,phase_id ON public.project_activities FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reference();
CREATE TRIGGER role_switch_guard_reference BEFORE INSERT OR UPDATE OF assigned_to,project_id ON public.document_requirements FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reference();
CREATE TRIGGER role_switch_guard_reference BEFORE INSERT OR UPDATE OF default_consultant_id ON public.template_activities FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reference();

CREATE OR REPLACE FUNCTION public.role_switch_guard_member_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.projects%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id AND NEW.consultant_id IS NOT DISTINCT FROM OLD.consultant_id THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.projects WHERE id=OLD.project_id;
  IF p.lifecycle_status='active' THEN
    IF EXISTS (SELECT 1 FROM public.profiles x WHERE x.id=OLD.consultant_id AND x.role='consultant' AND x.consultant_level='senior'
       AND x.is_active IS TRUE AND x.creation_pending IS NOT TRUE) AND NOT public.role_switch_project_senior(p.id,OLD.consultant_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PROJECT_SENIOR_REQUIRED';
    END IF;
    IF p.general_consultant_id=OLD.consultant_id OR EXISTS (
      SELECT 1 FROM public.project_activities a JOIN public.project_phases ph ON ph.id=a.phase_id
      WHERE ph.project_id=p.id AND a.assigned_to=OLD.consultant_id AND a.status<>'completed') OR EXISTS (
      SELECT 1 FROM public.document_requirements d LEFT JOIN public.project_activities a ON a.id=d.activity_id
      WHERE d.project_id=p.id AND d.deleted_at IS NULL AND NOT d.is_outgoing AND coalesce(d.status,'pending') NOT IN ('approved','closed')
        AND coalesce(d.assigned_to,CASE WHEN d.activity_id IS NOT NULL THEN a.assigned_to ELSE p.general_consultant_id END)=OLD.consultant_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='USER_ROLE_CHANGE_BLOCKED';
    END IF;
  END IF;
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.role_switch_guard_member_removal() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER role_switch_guard_member_removal BEFORE DELETE OR UPDATE OF consultant_id,project_id ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_member_removal();

-- Historical assignments do not prevent removal; the row trigger above checks current work.
CREATE OR REPLACE FUNCTION public.remove_project_member_if_unassigned(p_project_id uuid,p_member_id uuid)
RETURNS TABLE(removed boolean,consultant_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE member_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(105,1);
  PERFORM pg_advisory_xact_lock(105,2);
  PERFORM 1 FROM public.projects WHERE id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE='P0002'; END IF;
  DELETE FROM public.project_members m WHERE m.id=p_member_id AND m.project_id=p_project_id RETURNING m.consultant_id INTO member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project member not found' USING ERRCODE='P0002'; END IF;
  RETURN QUERY SELECT true,member_id;
END $$;



-- Reopening checks current work without changing its historical author fields.
CREATE OR REPLACE FUNCTION public.role_switch_check_project(p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.projects%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.projects WHERE id=p_project;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PROJECT_NOT_FOUND'; END IF;
  IF NOT public.role_switch_project_senior(p.id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='PROJECT_SENIOR_REQUIRED';
  END IF;
  IF (p.general_consultant_id IS NOT NULL AND NOT public.role_switch_eligible(p.general_consultant_id,p.id)) OR EXISTS (
    SELECT 1 FROM public.project_activities a JOIN public.project_phases ph ON ph.id=a.phase_id
    WHERE ph.project_id=p.id AND a.status<>'completed' AND
      ((a.assigned_to IS NOT NULL AND NOT public.role_switch_eligible(a.assigned_to,p.id)) OR (a.visibility='published' AND a.assigned_to IS NULL))
  ) OR EXISTS (
    SELECT 1 FROM public.document_requirements d LEFT JOIN public.project_activities a ON a.id=d.activity_id
    WHERE d.project_id=p.id AND d.deleted_at IS NULL AND NOT d.is_outgoing AND coalesce(d.status,'pending') NOT IN ('approved','closed')
      AND (d.visibility='published' OR coalesce(d.assigned_to,CASE WHEN d.activity_id IS NOT NULL THEN a.assigned_to ELSE p.general_consultant_id END) IS NOT NULL)
      AND NOT public.role_switch_eligible(coalesce(d.assigned_to,CASE WHEN d.activity_id IS NOT NULL THEN a.assigned_to ELSE p.general_consultant_id END),p.id)
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='USER_ROLE_CHANGE_BLOCKED'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.role_switch_check_project(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.role_switch_guard_reopening()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE project uuid;
BEGIN
  IF TG_TABLE_NAME='projects' THEN
    IF NEW.lifecycle_status='active' AND OLD.lifecycle_status IS DISTINCT FROM 'active' THEN
      PERFORM public.role_switch_check_project(NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME='project_phases' THEN
    IF OLD.status='completed' AND NEW.status<>'completed' THEN PERFORM public.role_switch_check_project(NEW.project_id); END IF;
  ELSIF TG_TABLE_NAME='project_activities' THEN
    IF OLD.status='completed' AND NEW.status<>'completed' THEN
      SELECT project_id INTO project FROM public.project_phases WHERE id=NEW.phase_id;
      IF NEW.assigned_to IS NOT NULL AND NOT public.role_switch_eligible(NEW.assigned_to,project) THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='USER_ROLE_CHANGE_BLOCKED';
      END IF;
      IF NEW.visibility='published' AND NEW.assigned_to IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='USER_ROLE_CHANGE_BLOCKED';
      END IF;
      PERFORM public.role_switch_check_project(project);
    END IF;
  ELSE
    IF OLD.status IN ('approved','closed') AND NEW.status NOT IN ('approved','closed') AND NEW.deleted_at IS NULL AND NOT NEW.is_outgoing THEN
      SELECT coalesce(NEW.assigned_to,CASE WHEN NEW.activity_id IS NOT NULL THEN a.assigned_to ELSE p.general_consultant_id END)
        INTO project FROM public.projects p LEFT JOIN public.project_activities a ON a.id=NEW.activity_id WHERE p.id=NEW.project_id;
      IF NOT public.role_switch_eligible(project,NEW.project_id) THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='USER_ROLE_CHANGE_BLOCKED';
      END IF;
      PERFORM public.role_switch_check_project(NEW.project_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.role_switch_guard_reopening() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER role_switch_guard_reopening BEFORE UPDATE OF lifecycle_status ON public.projects FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reopening();
CREATE TRIGGER role_switch_guard_reopening BEFORE UPDATE OF status ON public.project_phases FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reopening();
CREATE TRIGGER role_switch_guard_reopening BEFORE UPDATE OF status ON public.project_activities FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reopening();
CREATE TRIGGER role_switch_guard_reopening BEFORE UPDATE OF status ON public.document_requirements FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_reopening();

CREATE OR REPLACE FUNCTION public.role_switch_guard_template_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='project_templates' THEN
    IF NEW.is_active IS TRUE AND (OLD.is_active IS NOT TRUE OR (NEW.status='published' AND OLD.status IS DISTINCT FROM 'published')) AND EXISTS (
      SELECT 1 FROM public.template_phases ph JOIN public.template_activities a ON a.template_phase_id=ph.id
      WHERE ph.template_id=NEW.id AND ph.is_active IS TRUE AND a.is_active IS TRUE AND a.default_consultant_id IS NOT NULL
        AND NOT public.role_switch_eligible(a.default_consultant_id,NULL)) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INELIGIBLE_CONSULTANT';
    END IF;
  ELSIF TG_TABLE_NAME='template_phases' THEN
    IF NEW.is_active IS TRUE AND OLD.is_active IS NOT TRUE AND EXISTS (
      SELECT 1 FROM public.template_activities a WHERE a.template_phase_id=NEW.id AND a.is_active IS TRUE AND a.default_consultant_id IS NOT NULL
        AND NOT public.role_switch_eligible(a.default_consultant_id,NULL)) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INELIGIBLE_CONSULTANT';
    END IF;
  ELSE
    IF NEW.is_active IS TRUE AND OLD.is_active IS NOT TRUE AND NEW.default_consultant_id IS NOT NULL
      AND NOT public.role_switch_eligible(NEW.default_consultant_id,NULL) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INELIGIBLE_CONSULTANT';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.role_switch_guard_template_activation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER role_switch_guard_template_activation BEFORE UPDATE OF is_active,status ON public.project_templates FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_template_activation();
CREATE TRIGGER role_switch_guard_template_activation BEFORE UPDATE OF is_active ON public.template_phases FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_template_activation();
CREATE TRIGGER role_switch_guard_template_activation BEFORE UPDATE OF is_active ON public.template_activities FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_template_activation();



-- A published assignment and any inherited open request must remain usable.
CREATE OR REPLACE FUNCTION public.role_switch_guard_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE project uuid; owner uuid;
BEGIN
  IF TG_TABLE_NAME='project_activities' THEN
    SELECT ph.project_id INTO project FROM public.project_phases ph WHERE ph.id=NEW.phase_id;
    IF NEW.status<>'completed' AND NEW.visibility='published' AND NOT public.role_switch_eligible(NEW.assigned_to,project) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INELIGIBLE_CONSULTANT';
    END IF;
    IF EXISTS (SELECT 1 FROM public.document_requirements d WHERE d.activity_id=NEW.id AND d.assigned_to IS NULL
      AND d.deleted_at IS NULL AND NOT d.is_outgoing AND d.visibility='published' AND coalesce(d.status,'pending') NOT IN ('approved','closed'))
      AND NOT public.role_switch_eligible(NEW.assigned_to,project) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INELIGIBLE_CONSULTANT';
    END IF;
  ELSIF TG_TABLE_NAME='document_requirements' THEN
    IF NEW.deleted_at IS NULL AND NOT NEW.is_outgoing AND NEW.visibility='published' AND coalesce(NEW.status,'pending') NOT IN ('approved','closed') THEN
      SELECT coalesce(NEW.assigned_to,CASE WHEN NEW.activity_id IS NOT NULL THEN a.assigned_to ELSE p.general_consultant_id END)
      INTO owner FROM public.projects p LEFT JOIN public.project_activities a ON a.id=NEW.activity_id WHERE p.id=NEW.project_id;
      IF NOT public.role_switch_eligible(owner,NEW.project_id) THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INELIGIBLE_CONSULTANT';
      END IF;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.document_requirements d WHERE d.project_id=NEW.id AND d.activity_id IS NULL AND d.assigned_to IS NULL
      AND d.deleted_at IS NULL AND NOT d.is_outgoing AND d.visibility='published' AND coalesce(d.status,'pending') NOT IN ('approved','closed'))
      AND NOT public.role_switch_eligible(NEW.general_consultant_id,NEW.id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INELIGIBLE_CONSULTANT';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.role_switch_guard_publication() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER role_switch_guard_publication BEFORE INSERT OR UPDATE OF assigned_to,phase_id,visibility,status ON public.project_activities FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_publication();
CREATE TRIGGER role_switch_guard_publication BEFORE INSERT OR UPDATE OF assigned_to,project_id,activity_id,visibility,status,deleted_at ON public.document_requirements FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_publication();
CREATE TRIGGER role_switch_guard_publication BEFORE UPDATE OF general_consultant_id ON public.projects FOR EACH ROW EXECUTE FUNCTION public.role_switch_guard_publication();





CREATE INDEX IF NOT EXISTS role_switch_project_general_idx ON public.projects(general_consultant_id) WHERE general_consultant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS role_switch_member_consultant_idx ON public.project_members(consultant_id,project_id);
CREATE INDEX IF NOT EXISTS role_switch_template_default_idx ON public.template_activities(default_consultant_id) WHERE default_consultant_id IS NOT NULL;


-- Existing #105 RPCs lock rows before their first table write. Take the same
-- reference lock before those row locks, in the same order as direct writes.
DO $lock_order$
DECLARE name text; oid_value oid; definition text; anchor text := 'PERFORM pg_advisory_xact_lock_shared(105, 1);';
BEGIN
  FOREACH name IN ARRAY ARRAY['finalize_template_import','apply_duplicate_assignments',
    'complete_reserved_document_upload_batch','review_document_request',
    'delete_project_activity_preserving_requests','delete_project_phase_preserving_requests','finalize_reminder_claim'] LOOP
    SELECT p.oid INTO STRICT oid_value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=name;
    SELECT pg_get_functiondef(oid_value) INTO definition;
    IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 THEN
      RAISE EXCEPTION 'Unrecognized lock ordering in %',name;
    END IF;
    EXECUTE replace(definition,anchor,anchor || E'\n  PERFORM pg_advisory_xact_lock(105, 2);');
  END LOOP;
END
$lock_order$;


CREATE INDEX IF NOT EXISTS role_switch_project_closer_idx ON public.projects(closed_by) WHERE closed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS role_switch_phase_closer_idx ON public.project_phases(completed_by) WHERE completed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS role_switch_activity_closer_idx ON public.project_activities(completed_by) WHERE completed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS role_switch_review_author_idx ON public.document_request_reviews(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS role_switch_file_author_idx ON public.files(uploaded_by) WHERE uploaded_by IS NOT NULL;
