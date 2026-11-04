-- Read-only initial inventory. Run against the intended database explicitly.
BEGIN READ ONLY;
WITH eligible AS (
  SELECT id, consultant_level FROM public.profiles
  WHERE role = 'consultant' AND is_active IS TRUE AND creation_pending IS FALSE
), affected AS (
  SELECT 'project_without_senior'::text AS kind, p.id AS entity_id,
    p.id AS project_id, NULL::uuid AS profile_id
  FROM public.projects p
  WHERE p.lifecycle_status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.project_members m JOIN eligible e ON e.id = m.consultant_id
    WHERE m.project_id = p.id AND e.consultant_level = 'senior'
  )
  UNION ALL
  SELECT 'ineligible_general_consultant', p.id, p.id, p.general_consultant_id
  FROM public.projects p
  WHERE p.lifecycle_status = 'active' AND p.general_consultant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.project_members m JOIN eligible e ON e.id = m.consultant_id
      WHERE m.project_id = p.id AND e.id = p.general_consultant_id)
  UNION ALL
  SELECT 'ineligible_activity_assignee', a.id, ph.project_id, a.assigned_to
  FROM public.project_activities a JOIN public.project_phases ph ON ph.id = a.phase_id
    JOIN public.projects p ON p.id = ph.project_id
  WHERE p.lifecycle_status = 'active' AND a.status <> 'completed'
    AND (a.assigned_to IS NOT NULL OR a.visibility = 'published')
    AND NOT EXISTS (SELECT 1 FROM public.project_members m JOIN eligible e ON e.id = m.consultant_id
      WHERE m.project_id = p.id AND e.id = a.assigned_to)
  UNION ALL
  SELECT 'ineligible_request_assignee', d.id, p.id, owner.id
  FROM public.document_requirements d JOIN public.projects p ON p.id = d.project_id
    LEFT JOIN public.project_activities a ON a.id = d.activity_id
    CROSS JOIN LATERAL (SELECT coalesce(d.assigned_to,
      CASE WHEN d.activity_id IS NOT NULL THEN a.assigned_to ELSE p.general_consultant_id END) AS id) owner
  WHERE p.lifecycle_status = 'active' AND d.deleted_at IS NULL AND NOT d.is_outgoing
    AND d.status NOT IN ('approved', 'closed')
    AND ((owner.id IS NULL AND (d.visibility = 'published' OR d.status = 'review')) OR (owner.id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.project_members m JOIN eligible e ON e.id = m.consultant_id
      WHERE m.project_id = p.id AND e.id = owner.id)))
  UNION ALL
  SELECT 'ineligible_template_default', a.id, NULL::uuid, a.default_consultant_id
  FROM public.template_activities a JOIN public.template_phases ph ON ph.id = a.template_phase_id
    JOIN public.project_templates t ON t.id = ph.template_id
  WHERE a.default_consultant_id IS NOT NULL AND a.is_active IS TRUE AND ph.is_active IS TRUE
    AND t.is_active IS TRUE AND NOT EXISTS (SELECT 1 FROM eligible e WHERE e.id = a.default_consultant_id)
  UNION ALL
  SELECT 'internal_profile_with_client_data', id, NULL::uuid, id
  FROM public.profiles WHERE role IN ('admin', 'consultant')
    AND (nullif(btrim(cif), '') IS NOT NULL OR nullif(btrim(nume_firma), '') IS NOT NULL
      OR nullif(btrim(adresa_firma), '') IS NOT NULL)
  UNION ALL
  SELECT 'internal_profile_owns_client_project', p.id, p.id, p.client_id
  FROM public.projects p JOIN public.profiles u ON u.id = p.client_id
  WHERE u.role IN ('admin', 'consultant')
)
SELECT kind, entity_id, project_id, profile_id FROM affected ORDER BY kind, entity_id;
ROLLBACK;
