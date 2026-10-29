import type { SupabaseClient } from '@supabase/supabase-js'
import type { CifError } from '../../../lib/cif.ts'
import { userLifecycleConflict } from './user-lifecycle.ts'

export type UserApiFailure = {
  status: number
  body: { code: string; message: string; field?: 'cif' | 'cifCountry' }
}

export const cifForbidden: UserApiFailure = {
  status: 403,
  body: { code: 'CIF_FORBIDDEN', message: 'Modificarea CIF-ului necesită admin și rolul final client.', field: 'cif' },
}
export const cifDuplicate: UserApiFailure = {
  status: 409,
  body: { code: 'CIF_DUPLICATE', message: 'Firma are deja un cont. Nu poți folosi același CIF.', field: 'cif' },
}
export const creationUnconfirmed: UserApiFailure = {
  status: 503,
  body: { code: 'ACCOUNT_CREATION_UNCONFIRMED', message: 'Nu am putut confirma finalizarea contului. Datele de acces nu au fost trimise. Verifică lista de utilizatori înainte de a reîncerca.' },
}
const creationFailed: UserApiFailure = {
  status: 500,
  body: { code: 'ACCOUNT_CREATION_FAILED', message: 'Contul nu a putut fi finalizat. Datele de acces nu au fost trimise.' },
}
const creationPending: UserApiFailure = {
  status: 500,
  body: { code: 'ACCOUNT_CREATION_PENDING', message: 'Contul a rămas incomplet și blocat. Este necesară remedierea din lista de utilizatori.' },
}
const creationInactive: UserApiFailure = {
  status: 409,
  body: { code: 'ACCOUNT_CREATION_INACTIVE', message: 'Contul a fost finalizat, dar este acum dezactivat. Datele de acces nu au fost trimise.' },
}

export function cifValidationFailure(error: CifError): UserApiFailure {
  return { status: 400, body: { code: error.code, message: error.message, field: error.field } }
}

export function userCifConflict(error: unknown): UserApiFailure | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate.code === '23505' && typeof candidate.message === 'string'
    && /unique constraint "profiles_cif_unique"/.test(candidate.message)) return cifDuplicate
  if (candidate.code !== 'P0001') return null
  if (candidate.message === 'CIF_FORBIDDEN') return cifForbidden
  if (candidate.message === 'CIF_REQUIRED') return { status: 400, body: { code: 'CIF_REQUIRED', message: 'Completează CIF-ul firmei.', field: 'cif' } }
  if (candidate.message === 'CIF_INVALID') return { status: 400, body: { code: 'CIF_INVALID', message: 'CIF-ul nu e valid. Verifică numărul și țara.', field: 'cif' } }
  if (candidate.message === 'CIF_COUNTRY_UNSUPPORTED') return { status: 400, body: { code: 'CIF_COUNTRY_UNSUPPORTED', message: 'Alege o țară din Uniunea Europeană.', field: 'cifCountry' } }
  return null
}

export async function checkCifAvailable(admin: SupabaseClient, cif: string | null, ownId?: string): Promise<UserApiFailure | null> {
  try {
    // The pending column also prevents Auth creation against the old schema.
    let query = admin.from('profiles').select('id,creation_pending')
    if (cif !== null) query = query.eq('cif', cif)
    if (ownId) query = query.neq('id', ownId)
    const { data, error } = await query.limit(cif === null ? 0 : 1).maybeSingle()
    if (!error) return cif !== null && data ? cifDuplicate : null
  } catch { /* A failed lookup must not permit creation. */ }
  return { status: 503, body: { code: 'ACCOUNT_DATA_UNAVAILABLE', message: 'Nu am putut verifica datele contului. Încearcă din nou mai târziu.' } }
}

export function persistedAuthTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null
  // Go truncates to microseconds; Date loses them and a SQL cast may round.
  return value.replace(/(\.\d{6})\d+(Z|[+-]\d{2}:\d{2})$/, '$1$2')
}

async function creationState(admin: SupabaseClient, userId: string) {
  try {
    const { data, error } = await admin.from('profiles').select('creation_pending,is_active').eq('id', userId).maybeSingle()
    if (error) return 'unknown'
    if (!data) return 'absent'
    if (data.creation_pending === false && data.is_active === true) return 'finalized'
    if (data.creation_pending === false && data.is_active === false) return 'inactive'
    if (data.creation_pending === true && data.is_active === false) return 'pending'
  } catch { /* An unavailable read is not evidence of rollback. */ }
  return 'unknown'
}

export async function finalizeCreatedAccount(admin: SupabaseClient, input: {
  userId: string; actorId: string; ban: string | null; role: 'client' | 'consultant' | 'admin'
  cif: string | null; profile: Record<string, string | null>
}): Promise<{ ok: true } | ({ ok: false } & UserApiFailure)> {
  let failure: unknown = { code: 'P0001', message: 'INVALID_CREATION_BAN' }
  if (input.ban !== null) {
    try {
      const { data, error } = await admin.rpc('finalize_new_user_account', {
        p_target_id: input.userId, p_actor_id: input.actorId, p_expected_ban: input.ban,
        p_role: input.role, p_cif: input.cif, p_profile: input.profile,
      })
      if (!error && data?.finalized === true && data.userId === input.userId) return { ok: true }
      failure = error
    } catch (error) { failure = error }
  }
  const original = userCifConflict(failure) ?? userLifecycleConflict(failure) ?? creationFailed
  const state = await creationState(admin, input.userId)
  if (state === 'finalized') return { ok: true }
  if (state === 'inactive') return { ok: false, ...creationInactive }
  if (state === 'absent') return { ok: false, ...original }
  const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : null
  const certainFailure = typeof code === 'string' && ['P0001', '23505', '23514', '23502', '22P02', '42501', 'PGRST202'].includes(code)
  if (state !== 'pending' || !certainFailure) return { ok: false, ...creationUnconfirmed }

  // Cancellation rechecks pending under the account lock; never delete by email/CIF.
  try {
    const { data, error } = await admin.rpc('cancel_new_user_account', { p_target_id: input.userId, p_actor_id: input.actorId })
    if (!error && data?.deleted === true && data.userId === input.userId) return { ok: false, ...original }
  } catch { /* Reconcile a possibly lost cancellation reply as well. */ }
  const after = await creationState(admin, input.userId)
  if (after === 'finalized') return { ok: true }
  if (after === 'absent') return { ok: false, ...original }
  if (after === 'inactive') return { ok: false, ...creationInactive }
  return { ok: false, ...(after === 'pending' ? creationPending : creationUnconfirmed) }
}
