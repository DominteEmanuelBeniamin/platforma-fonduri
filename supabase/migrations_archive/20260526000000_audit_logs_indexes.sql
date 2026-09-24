-- audit_logs: indexuri pentru filtrele si view-urile din /admin/audit
-- Vezi docs/prd/PRD_AUDIT_LOG_COVERAGE_EXPANSION.md (sectiunea 5.1.5)

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON audit_logs(action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);
