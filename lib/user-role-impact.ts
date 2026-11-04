export type RoleImpactItem = {
  id: string
  kind: string
  title: string
  reason: string
  project_id?: string
  project_name?: string
  template_id?: string
  template_name?: string
  state?: string
  source?: string
  url?: string
}

export type RoleImpact = {
  target_id: string
  changes: Record<string, unknown>
  checked_at: string
  blockers: RoleImpactItem[]
  information: RoleImpactItem[]
  totals: { blockers: number; information: number }
  warnings: string[]
}

export function isRoleImpact(value: unknown, targetId: string): value is RoleImpact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const impact = value as Record<string, unknown>
  if (impact.target_id !== targetId || typeof impact.checked_at !== 'string' || Number.isNaN(Date.parse(impact.checked_at))
    || !impact.changes || typeof impact.changes !== 'object' || Array.isArray(impact.changes)
    || !Array.isArray(impact.blockers) || !Array.isArray(impact.information)
    || !Array.isArray(impact.warnings) || !impact.warnings.every(warning => typeof warning === 'string')
    || !impact.totals || typeof impact.totals !== 'object' || Array.isArray(impact.totals)) return false
  const totals = impact.totals as Record<string, unknown>
  const validItem = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const row = item as Record<string, unknown>
    return ['id', 'kind', 'title', 'reason'].every(key => typeof row[key] === 'string')
      && ['project_id', 'template_id'].every(key => row[key] == null || typeof row[key] === 'string')
  }
  return totals.blockers === impact.blockers.length && totals.information === impact.information.length
    && impact.blockers.every(validItem) && impact.information.every(validItem)
}

export function roleImpactRequest(value: unknown): { changes: Record<string, unknown> } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !['role', 'consultant_level', 'is_active'].includes(key))) return null
  if (body.role !== undefined && body.role !== 'admin' && body.role !== 'consultant') return null
  if (body.consultant_level !== undefined && body.consultant_level !== 'junior' && body.consultant_level !== 'senior') return null
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return null
  if (!Object.keys(body).length) return null
  return { changes: body }
}
