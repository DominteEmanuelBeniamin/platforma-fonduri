/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/users/[userId]/route.ts
import { requireAdmin, guardToResponse } from '../../_utils/auth'
import { createSupabaseServiceClient } from '../../_utils/supabase'
import { getClientIP, getUserAgent } from '../../_utils/audit'
import { sendEmailChangedNotices } from '../../_utils/email-changed-email'
import { userLifecycleConflict } from '../../_utils/user-lifecycle'
import { cifForbidden, cifValidationFailure, checkCifAvailable, userCifConflict } from '../../_utils/user-creation'
import { validateCif } from '@/lib/cif'
import { isUuid } from '@/lib/notification-utils'
import { completeProfileProblem, isEditableRole, normalizeProfileEmail, profileFieldProblem, type ProfileTextField } from '@/lib/profile-edit'
import { after, NextResponse } from 'next/server'

type PatchBody = Partial<{
  full_name: unknown
  role: unknown
  telefon: unknown
  cif: unknown
  cifCountry: unknown
  email: unknown
  consultant_level: unknown
  nume_firma: unknown
  adresa_firma: unknown
  departament: unknown
  specializare: unknown
}>

const TEXT_FIELDS: ProfileTextField[] = ['email', 'full_name', 'telefon', 'nume_firma', 'adresa_firma', 'departament', 'specializare']
const AUDIT_KEYS = ['full_name', 'role', 'telefon', 'cif', 'consultant_level', 'email', 'nume_firma', 'adresa_firma', 'departament', 'specializare']

// Erorile funcției `update_user_profile_guarded` care țin de datele trimise.
const PROFILE_ERRORS: Record<string, { status: number; field?: string; message: string }> = {
  EMAIL_TAKEN: { status: 409, field: 'email', message: 'Există deja un cont cu acest email.' },
  EMAIL_INVALID: { status: 400, field: 'email', message: 'Completează un email valid.' },
  PROFILE_FIELD_REQUIRED: { status: 400, message: 'Completează câmpurile obligatorii.' },
  INVALID_PROFILE_PATCH: { status: 400, message: 'Datele profilului nu sunt valide.' },
  ACTIVE_ADMIN_REQUIRED: { status: 403, message: 'Doar un administrator activ poate modifica datele conturilor.' },
}

function profileUpdateError(error: { code?: string; message?: string }) {
  const known = error.code === 'P0001' && error.message ? PROFILE_ERRORS[error.message] : undefined
  return known
    ? NextResponse.json({ code: error.message, field: known.field, error: known.message, message: known.message }, { status: known.status })
    : null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: targetUserId } = await params
    if (!isUuid(targetUserId)) {
      return NextResponse.json({ error: 'User ID trebuie să fie UUID valid' }, { status: 400 })
    }

    // Datele conturilor le modifică doar adminul, inclusiv pe ale lui.
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)
    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
    }
    const hasCif = Object.hasOwn(body, 'cif')
    const hasCountry = Object.hasOwn(body, 'cifCountry')
    if (hasCountry && !hasCif) return NextResponse.json({ code: 'CIF_INVALID', message: 'Trimite CIF-ul împreună cu țara selectată.', field: 'cifCountry' }, { status: 400 })
    const admin = createSupabaseServiceClient()
    const { data: oldProfile, error: profileError } = await admin
      .from('profiles')
      .select('id, email, full_name, role, consultant_level, telefon, cif, nume_firma, adresa_firma, departament, specializare, creation_pending')
      .eq('id', targetUserId)
      .maybeSingle()
    if (profileError) {
      console.error('PATCH user profile lookup failed:', { code: profileError.code })
      return NextResponse.json({ error: 'Nu am putut încărca profilul.' }, { status: 500 })
    }
    if (!oldProfile) return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 })

    if (oldProfile.creation_pending) {
      const pending = userLifecycleConflict({ code: 'P0001', message: 'ACCOUNT_CREATION_PENDING' })!
      return NextResponse.json(pending.body, { status: pending.status })
    }

    const update: Record<string, any> = {}
    if (body.role !== undefined) {
      if (typeof body.role !== 'string' || body.role.trim().length === 0) {
        return NextResponse.json({ error: 'role must be a non-empty string' }, { status: 400 })
      }
      const role = body.role.trim()
      if (!new Set(['admin', 'client', 'consultant']).has(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }
      update.role = role
    }
    if (body.consultant_level !== undefined) {
      if (body.consultant_level !== 'junior' && body.consultant_level !== 'senior') {
        return NextResponse.json({ error: 'consultant_level must be junior or senior' }, { status: 400 })
      }
      if ((update.role ?? oldProfile.role) !== 'consultant') {
        return NextResponse.json({ error: 'consultant_level se poate seta doar pentru consultanți' }, { status: 400 })
      }
      update.consultant_level = body.consultant_level
    }
    const finalRole = update.role ?? oldProfile.role
    if (finalRole !== oldProfile.role && (finalRole === 'client' || oldProfile.role === 'client')) {
      return NextResponse.json({ code: 'CLIENT_ROLE_CONVERSION_FORBIDDEN', message: 'Conturile de client nu pot fi convertite în conturi interne sau invers.' }, { status: 409 })
    }
    const texts: Partial<Record<ProfileTextField, unknown>> = {}
    for (const key of TEXT_FIELDS) if (body[key] !== undefined) texts[key] = body[key]
    if (Object.keys(texts).length > 0) {
      if (!isEditableRole(finalRole)) return NextResponse.json({ code: 'INVALID_PROFILE_PATCH', message: 'Datele profilului nu sunt valide.' }, { status: 400 })
      const problem = profileFieldProblem(finalRole, texts)
      if (problem) return NextResponse.json({ code: 'INVALID_PROFILE_PATCH', field: problem.field, error: problem.message, message: problem.message }, { status: 400 })
      for (const [key, value] of Object.entries(texts)) {
        const text = typeof value === 'string' ? value.trim() : ''
        update[key] = key === 'email' ? normalizeProfileEmail(text) : text || null
      }
    }
    if (isEditableRole(finalRole)) {
      const problem = completeProfileProblem(finalRole, { ...oldProfile, ...update })
      if (problem) return NextResponse.json({ code: 'PROFILE_FIELD_REQUIRED', field: problem.field, message: problem.message }, { status: 400 })
      if (finalRole !== oldProfile.role && finalRole === 'consultant' && body.consultant_level === undefined) {
        return NextResponse.json({ code: 'INVALID_PROFILE_PATCH', field: 'consultant_level', message: 'Alege nivelul consultantului.' }, { status: 400 })
      }
    }
    if (hasCif && finalRole !== 'client') return NextResponse.json(cifForbidden.body, { status: cifForbidden.status })
    if (finalRole === 'client') {
      const result = validateCif(hasCif ? body.cif : oldProfile.cif, hasCif ? body.cifCountry : undefined)
      if (!result.ok) {
        const failure = cifValidationFailure(result)
        return NextResponse.json(failure.body, { status: failure.status })
      }
      if (hasCif) {
        const unavailable = await checkCifAvailable(admin, result.cif, targetUserId)
        if (unavailable) return NextResponse.json(unavailable.body, { status: unavailable.status })
        update.cif = result.cif
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'Nothing to update. Allowed fields: ' + AUDIT_KEYS.join(', ') + '.' },
        { status: 400 }
      )
    }

    const { data: result, error } = await admin.rpc('update_user_profile_guarded_audited', {
      p_target_id: targetUserId,
      p_actor_id: ctx.user.id,
      p_changes: update,
      p_ip_address: getClientIP(request),
      p_user_agent: getUserAgent(request),
    })
    if (error) {
      const conflict = userCifConflict(error) ?? userLifecycleConflict(error)
      if (conflict) return NextResponse.json(conflict.body, { status: conflict.status })
      const known = profileUpdateError(error)
      if (known) return known
      console.error('PATCH guarded profile update failed:', { code: error.code })
      return NextResponse.json({ error: 'Nu am putut actualiza profilul.' }, { status: 500 })
    }

    const profile = result?.profile
    const changed = result?.changed
    const oldValues = result?.oldValues
    const newValues = result?.newValues
    const validAudit = [oldValues, newValues].every(values => values && typeof values === 'object'
      && !Array.isArray(values) && Object.keys(values).every(key => AUDIT_KEYS.includes(key)))
    if (!profile || profile.id !== targetUserId || typeof changed !== 'boolean' || !validAudit) {
      console.error('PATCH guarded profile update returned an invalid result:', { targetUserId })
      return NextResponse.json({ error: 'Nu am putut confirma actualizarea profilului.' }, { status: 500 })
    }

    if (changed && Object.hasOwn(newValues, 'email') && typeof oldValues.email === 'string') {
      const notice = { oldEmail: oldValues.email, newEmail: String(newValues.email), fullName: profile.full_name ?? null }
      after(() => sendEmailChangedNotices(notice))
    }

    return NextResponse.json({ message: 'Profile updated', profile, changed })
  } catch (error) {
    console.error('PATCH /api/users/[userId] error:', { code: error && typeof error === 'object' && 'code' in error ? error.code : 'unknown' })
    return NextResponse.json({ error: 'Nu am putut actualiza profilul.' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params
    if (!isUuid(userId)) {
      return NextResponse.json({ error: 'User ID trebuie să fie UUID valid' }, { status: 400 })
    }

    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()
    const { data: deleted, error } = await admin.rpc('delete_empty_user_account', {
      p_target_id: userId,
      p_actor_id: ctx.user.id,
      p_ip_address: getClientIP(request),
      p_user_agent: getUserAgent(request),
    })
    if (error) {
      const conflict = userLifecycleConflict(error)
      if (conflict) return NextResponse.json(conflict.body, { status: conflict.status })
      console.error('DELETE guarded user lifecycle RPC failed:', error)
      return NextResponse.json({ error: 'Nu am putut șterge utilizatorul.' }, { status: 500 })
    }

    if (!deleted || typeof deleted !== 'object' || (deleted as any).deleted !== true) {
      console.error('DELETE account lifecycle RPC returned an invalid result:', { targetUserId: userId })
      return NextResponse.json({ error: 'Nu am putut confirma ștergerea utilizatorului.' }, { status: 500 })
    }
    return NextResponse.json({ message: 'Utilizator șters cu succes!' })
  } catch (error) {
    console.error('DELETE /api/users/[userId] error:', error)
    return NextResponse.json({ error: 'Nu am putut șterge utilizatorul.' }, { status: 500 })
  }
}
