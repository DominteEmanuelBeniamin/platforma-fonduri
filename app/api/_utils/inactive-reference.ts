type InactiveReferenceError = {
  code?: unknown
  message?: unknown
  details?: unknown
}

export type InactiveReferenceDetails = {
  user_id: string
  field: string
}

/** Accept only the database trigger's dedicated marker and its documented JSON detail. */
export function getInactiveReferenceDetails(error: unknown): InactiveReferenceDetails | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as InactiveReferenceError
  if (candidate.code !== 'P0001' || candidate.message !== 'INACTIVE_REFERENCE') return null
  if (typeof candidate.details !== 'string') return null

  try {
    const details = JSON.parse(candidate.details) as Record<string, unknown>
    if (typeof details.user_id !== 'string' || typeof details.field !== 'string') return null
    return { user_id: details.user_id, field: details.field }
  } catch {
    return null
  }
}

export function inactiveReferenceConflict(error: unknown, message: string) {
  const details = getInactiveReferenceDetails(error)
  return details
    ? { status: 409 as const, body: { code: 'INACTIVE_REFERENCE', message, details } }
    : null
}
