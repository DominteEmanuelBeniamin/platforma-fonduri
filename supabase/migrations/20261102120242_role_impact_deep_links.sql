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
      'reason','Înlocuiește consultantul general.','project_id',p.id,'project_name',p.title,'state',p.lifecycle_status,'url','/projects/'||p.id||'?phase=__general__&general_consultant=1') AS item
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
      'project_id',p.id,'project_name',p.title,'state',p.lifecycle_status,'url','/projects/'||p.id||'?team=1')
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
      'project_id',p.id,'project_name',p.title,'state',p.lifecycle_status,'url','/projects/'||p.id||'?team=1')
    FROM public.project_members m JOIN public.projects p ON p.id=m.project_id WHERE m.consultant_id=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',p.id,'kind','historical_project_closer','title',p.title,'reason','Autorul încheierii rămâne neschimbat.',
      'project_id',p.id,'project_name',p.title,'url','/projects/'||p.id)
    FROM public.projects p WHERE p.closed_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',ph.id,'kind','historical_phase_closer','title',ph.name,'reason','Autorul finalizării rămâne neschimbat.',
      'project_id',p.id,'project_name',p.title,'url','/projects/'||p.id||'?phase='||ph.id)
    FROM public.project_phases ph JOIN public.projects p ON p.id=ph.project_id WHERE ph.completed_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',a.id,'kind','historical_activity_closer','title',a.name,'reason','Autorul finalizării rămâne neschimbat.',
      'project_id',p.id,'project_name',p.title,'url','/projects/'||p.id||'?phase='||ph.id||'&activity='||a.id)
    FROM public.project_activities a JOIN public.project_phases ph ON ph.id=a.phase_id JOIN public.projects p ON p.id=ph.project_id WHERE a.completed_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',r.id,'kind','historical_review','title',coalesce(d.name,'Cerere de documente'),
      'reason','Autorul verificării rămâne neschimbat.','project_id',p.id,'project_name',p.title,'url','/projects/'||p.id||'?phase='||coalesce(a.phase_id::text,'__general__')||CASE WHEN a.id IS NOT NULL THEN '&activity='||a.id ELSE '' END||'&document='||d.id)
    FROM public.document_request_reviews r JOIN public.document_requirements d ON d.id=r.requirement_id JOIN public.projects p ON p.id=d.project_id LEFT JOIN public.project_activities a ON a.id=d.activity_id WHERE r.reviewed_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',f.id,'kind','historical_upload','title',coalesce(d.name,'Cerere de documente'),
      'reason','Autorul încărcării rămâne neschimbat.','project_id',p.id,'project_name',p.title,'url','/projects/'||p.id||'?phase='||coalesce(a.phase_id::text,'__general__')||CASE WHEN a.id IS NOT NULL THEN '&activity='||a.id ELSE '' END||'&document='||d.id)
    FROM public.files f JOIN public.document_requirements d ON d.id=f.requirement_id JOIN public.projects p ON p.id=d.project_id LEFT JOIN public.project_activities a ON a.id=d.activity_id WHERE f.uploaded_by=t.id
    UNION ALL
    SELECT false,jsonb_build_object('id',a.id,'kind','historical_activity','title',a.name,'reason','Responsabilitate istorică.',
      'project_id',p.id,'project_name',p.title,'state',a.status,'url','/projects/'||p.id||'?phase='||ph.id||'&activity='||a.id)
    FROM public.project_activities a JOIN public.project_phases ph ON ph.id=a.phase_id JOIN public.projects p ON p.id=ph.project_id
    WHERE a.assigned_to=t.id AND (p.lifecycle_status<>'active' OR a.status='completed')
    UNION ALL
    SELECT false,jsonb_build_object('id',d.id,'kind','historical_request','title',coalesce(d.name,'Cerere de documente'),'reason','Responsabilitate istorică.',
      'project_id',p.id,'project_name',p.title,'state',d.status,'url','/projects/'||p.id||'?phase='||coalesce(a.phase_id::text,'__general__')||CASE WHEN a.id IS NOT NULL THEN '&activity='||a.id ELSE '' END||'&document='||d.id)
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
