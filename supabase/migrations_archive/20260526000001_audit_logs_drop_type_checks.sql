-- audit_logs: renunta la CHECK pe entity_type / action_type
-- Vezi docs/prd/PRD_AUDIT_LOG_COVERAGE_EXPANSION.md (sectiunea 5.1.3):
--   "action_type si entity_type raman `text` in DB - nu necesita migratie pentru tipuri noi"
-- Constraintele au fost create direct in Supabase si blocheaza tipurile noi
-- (template, template_phase, template_activity, status, project_member, download, etc).

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_type_check;
