export type RetentionPolicy = {
  enabled?: boolean | null
  retention_hours?: number | string | bigint | null
}

export type RetentionEligibilityInput = {
  policy?: RetentionPolicy | null
  retentionUntil?: string | Date | null
  legalHoldAt?: string | Date | null
  now?: Date
}

export type PurgeDateInput = {
  deletedAt: string | Date | null | undefined
  graceRetentionHours: number | string | bigint | null | undefined
  retentionUntilDates?: Array<string | Date | null | undefined>
  requireBusinessRetention?: boolean
  legalHoldAt?: string | Date | null
  businessRetentionStartAt?: string | Date | null
  businessRetentionHours?: number | string | bigint | null
}

export function firstClaimedUploadBatch<T>(data: T | T[] | null | undefined): T | null {
  return Array.isArray(data) ? data[0] ?? null : data ?? null
}

export function isRetentionPolicyEnabled(policy: RetentionPolicy | null | undefined): boolean {
  if (policy?.enabled !== true) return false
  if (policy.retention_hours === null || policy.retention_hours === undefined) return false
  if (!['number', 'string', 'bigint'].includes(typeof policy.retention_hours)) return false
  const hours = Number(policy.retention_hours)
  return Number.isFinite(hours) && hours > 0
}

export function isRetentionDue(timestamp: string | Date | null | undefined, now = new Date()): boolean {
  if (timestamp === null || timestamp === undefined || Number.isNaN(now.getTime())) return false
  if (!(timestamp instanceof Date) && typeof timestamp !== 'string') return false
  const dueAt = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp)
  return Number.isFinite(dueAt) && dueAt <= now.getTime()
}

export function isRetentionEligible({
  policy,
  retentionUntil,
  legalHoldAt,
  now = new Date(),
}: RetentionEligibilityInput): boolean {
  return isRetentionPolicyEnabled(policy) && !legalHoldAt && isRetentionDue(retentionUntil, now)
}

function dateMilliseconds(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    const milliseconds = value.getTime()
    return Number.isFinite(milliseconds) ? milliseconds : null
  }
  if (typeof value !== 'string') return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : null
}

function retentionMilliseconds(hours: number | string | bigint | null | undefined) {
  if (hours === null || hours === undefined) return null
  if (!['number', 'string', 'bigint'].includes(typeof hours)) return null
  const numericHours = Number(hours)
  if (!Number.isSafeInteger(numericHours) || numericHours <= 0) return null
  const milliseconds = numericHours * 60 * 60 * 1000
  return Number.isSafeInteger(milliseconds) ? milliseconds : null
}

/**
 * Returns the first safe purge instant. Missing/invalid required dates and
 * legal holds deliberately produce null so callers cannot schedule deletion.
 */
export function computePurgeDate({
  deletedAt,
  graceRetentionHours,
  retentionUntilDates = [],
  requireBusinessRetention = false,
  legalHoldAt,
  businessRetentionStartAt,
  businessRetentionHours,
}: PurgeDateInput): string | null {
  if (legalHoldAt !== null && legalHoldAt !== undefined) return null

  const deletedAtMs = dateMilliseconds(deletedAt)
  const graceMs = retentionMilliseconds(graceRetentionHours)
  if (deletedAtMs === null || graceMs === null) return null

  const businessDates: number[] = []
  for (const value of retentionUntilDates) {
    if (value === null || value === undefined) continue
    const milliseconds = dateMilliseconds(value)
    if (milliseconds === null) return null
    businessDates.push(milliseconds)
  }

  if (businessRetentionStartAt !== null && businessRetentionStartAt !== undefined) {
    const startMs = dateMilliseconds(businessRetentionStartAt)
    const durationMs = retentionMilliseconds(businessRetentionHours)
    if (startMs === null || durationMs === null) return null
    businessDates.push(startMs + durationMs)
  } else if (businessRetentionHours !== null && businessRetentionHours !== undefined) {
    return null
  }

  if (requireBusinessRetention && businessDates.length === 0) return null

  const purgeAt = Math.max(deletedAtMs + graceMs, ...businessDates)
  const purgeDate = new Date(purgeAt)
  return Number.isFinite(purgeDate.getTime()) ? purgeDate.toISOString() : null
}
