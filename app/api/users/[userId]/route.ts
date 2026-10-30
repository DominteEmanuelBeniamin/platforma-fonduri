/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/users/[userId]/route.ts
import { requireUserOrAdmin, requireAdmin, guardToResponse } from '../../_utils/auth'
import { createSupabaseServiceClient } from '../../_utils/supabase'
import { logUserAction, getClientIP, getUserAgent } from '../../_utils/audit'
import { userLifecycleConflict } from '../../_utils/user-lifecycle'
import { cifForbidden, cifValidationFailure, checkCifAvailable, userCifConflict } from '../../_utils/user-creation'
import { validateCif } from '@/lib/cif'
import { isUuid } from '@/lib/notification-utils'
import { NextResponse } from 'next/server'

type PatchBody = Partial<{
  full_name: unknown
  role: unknown
  telefon: unknown
  cif: unknown
  cifCountry: unknown
  email: unknown
  consultant_level: unknown
}>

function isStringOrNullOrUndef(x: unknown) {
  return x === undefined || x === null || typeof x === 'string'
}

function normalizePhone(phone: string) {
  return phone.trim()
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

    const ctx = await requireUserOrAdmin(request, targetUserId)
    if (!ctx.ok) return guardToResponse(ctx)
    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
    }
    const hasCif = Object.hasOwn(body, 'cif')
    const hasCountry = Object.hasOwn(body, 'cifCountry')
    if ((hasCif || hasCountry) && !ctx.isAdmin) return NextResponse.json(cifForbidden.body, { status: cifForbidden.status })
    if (hasCountry && !hasCif) return NextResponse.json({ code: 'CIF_INVALID', message: 'Trimite CIF-ul împreună cu țara selectată.', field: 'cifCountry' }, { status: 400 })
    if (body.email !== undefined) return NextResponse.json({ message: 'Email cannot be updated via this endpoint' }, { status: 400 })
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
    if (body.full_name !== undefined) {
      if (typeof body.full_name !== 'string' || body.full_name.trim().length === 0) {
        return NextResponse.json({ error: 'full_name must be a non-empty string' }, { status: 400 })
      }
      update.full_name = body.full_name.trim()
    }
    if (body.telefon !== undefined) {
      if (!isStringOrNullOrUndef(body.telefon)) {
        return NextResponse.json({ error: 'telefon must be a string or null' }, { status: 400 })
      }
      update.telefon = typeof body.telefon === 'string' ? normalizePhone(body.telefon) : body.telefon
    }
    if (body.role !== undefined) {
      if (!ctx.isAdmin) {
        return NextResponse.json({ error: 'Forbidden: only admin can update role' }, { status: 403 })
      }
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
      if (!ctx.isAdmin) {
        return NextResponse.json({ error: 'Forbidden: only admin can update consultant_level' }, { status: 403 })
      }
      if (body.consultant_level !== 'junior' && body.consultant_level !== 'senior') {
        return NextResponse.json({ error: 'consultant_level must be junior or senior' }, { status: 400 })
      }
      if ((update.role ?? oldProfile.role) !== 'consultant') {
        return NextResponse.json({ error: 'consultant_level se poate seta doar pentru consultanți' }, { status: 400 })
      }
      update.consultant_level = body.consultant_level
    }
    const finalRole = update.role ?? oldProfile.role
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
        { error: 'Nothing to update. Allowed fields: full_name, telefon, cif, role and consultant_level (admin only).' },
        { status: 400 }
      )
    }

    const { data: result, error } = await admin.rpc('update_user_profile_guarded', {
      p_target_id: targetUserId,
      p_actor_id: ctx.user.id,
      p_changes: update,
    })
    if (error) {
      const conflict = userCifConflict(error) ?? userLifecycleConflict(error)
      if (conflict) return NextResponse.json(conflict.body, { status: conflict.status })
      console.error('PATCH guarded profile update failed:', { code: error.code })
      return NextResponse.json({ error: 'Nu am putut actualiza profilul.' }, { status: 500 })
    }

    const profile = result?.profile
    const changed = result?.changed
    const oldValues = result?.oldValues
    const newValues = result?.newValues
    const auditKeys = ['full_name', 'role', 'telefon', 'cif', 'consultant_level']
    const validAudit = [oldValues, newValues].every(values => values && typeof values === 'object'
      && !Array.isArray(values) && Object.keys(values).every(key => auditKeys.includes(key)))
    if (!profile || profile.id !== targetUserId || typeof changed !== 'boolean' || !validAudit) {
      console.error('PATCH guarded profile update returned an invalid result:', { targetUserId })
      return NextResponse.json({ error: 'Nu am putut confirma actualizarea profilului.' }, { status: 500 })
    }

    if (changed) {
      let description = String(ctx.profile.email) + ' a modificat utilizatorul ' + String(profile.email)
      if (Object.hasOwn(newValues, 'role')) {
        description = String(ctx.profile.email) + ' a schimbat rolul utilizatorului ' + String(profile.email)
          + ' din "' + oldValues.role + '" în "' + newValues.role + '"'
      } else if (Object.hasOwn(newValues, 'consultant_level')) {
        description = String(ctx.profile.email) + ' a schimbat nivelul consultantului ' + String(profile.email)
          + ' din "' + oldValues.consultant_level + '" în "' + newValues.consultant_level + '"'
      }

      await logUserAction({
        adminId: ctx.user.id,
        actionType: 'update',
        userId: targetUserId,
        userEmail: profile.email,
        oldValues: Object.keys(oldValues).length > 0 ? oldValues : null,
        newValues: Object.keys(newValues).length > 0 ? newValues : null,
        description,
        ipAddress: getClientIP(request),
        userAgent: getUserAgent(request),
      })
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
