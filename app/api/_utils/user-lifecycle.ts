export type UserLifecycleConflict = {
  status: number
  body: { code: string; message: string; details?: unknown }
}

type PostgrestError = { code?: unknown; message?: unknown; details?: unknown }

const lifecycleMessages: Record<string, string> = {
  SELF_ACCOUNT_ACTION: 'Nu poți acționa asupra propriului cont.',
  LAST_ACTIVE_ADMIN: 'Trebuie să rămână cel puțin un administrator activ.',
  ACTIVE_ADMIN_REQUIRED: 'Acțiunea necesită un administrator activ.',
  INVALID_PROFILE_PATCH: 'Datele profilului nu sunt valide.',
  USER_NOT_FOUND: 'Utilizatorul nu a fost găsit.',
  USER_HAS_RELATED_DATA: 'Contul are date asociate și nu poate fi șters.',
}

function parseBlockers(value: unknown): Array<{ kind: string; count: number }> | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as { blockers?: unknown }
    if (!Array.isArray(parsed.blockers)) return null
    const blockers = parsed.blockers
    if (!blockers.every(item =>
      item && typeof item === 'object'
      && typeof item.kind === 'string'
      && Number.isFinite(item.count)
    )) return null
    return blockers
  } catch {
    return null
  }
}

export function userLifecycleConflict(error: unknown): UserLifecycleConflict | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as PostgrestError
  if (candidate.code !== 'P0001' || typeof candidate.message !== 'string') return null
  const message = lifecycleMessages[candidate.message]
  if (!message) return null

  if (candidate.message === 'USER_HAS_RELATED_DATA') {
    const blockers = parseBlockers(candidate.details)
    return {
      status: 409,
      body: {
        code: candidate.message,
        message,
        ...(blockers ? { details: { blockers } } : {}),
      },
    }
  }

  const status = candidate.message === 'USER_NOT_FOUND'
    ? 404
    : candidate.message === 'ACTIVE_ADMIN_REQUIRED'
    ? 403
    : candidate.message === 'INVALID_PROFILE_PATCH'
    ? 400
    : 409
  return { status, body: { code: candidate.message, message } }
}


