/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/users/[userId]/route.ts
import { requireUserOrAdmin, requireAdmin, guardToResponse } from '../../_utils/auth'
import { createSupabaseServiceClient } from '../../_utils/supabase'
import { logUserAction, getClientIP, getUserAgent } from '../../_utils/audit'
import { queueDeletionJob } from '../../_utils/deletion-scheduling'
import { NextResponse } from 'next/server'

type PatchBody = Partial<{
  full_name: unknown
  role: unknown
  telefon: unknown
  cif: unknown
  email: unknown
}>

function isStringOrNullOrUndef(x: unknown) {
  return x === undefined || x === null || typeof x === 'string'
}

function normalizePhone(phone: string) {
  return phone.trim()
}

function normalizeCui(cui: string) {
  return cui.trim()
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: targetUserId } = await params

    if (!targetUserId) {
      return NextResponse.json({ error: 'User ID lipsește din URL' }, { status: 400 })
    }

    const ctx = await requireUserOrAdmin(request, targetUserId)
    if(!ctx.ok) return guardToResponse(ctx)
    const admin = createSupabaseServiceClient()

    // Obținem profilul curent ÎNAINTE de update (pentru audit)
    const { data: oldProfile } = await admin
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', targetUserId)
      .single()

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (body.email !== undefined) {
      return NextResponse.json({ error: 'Email cannot be updated via this endpoint' }, { status: 400 })
    }

    const update: Record<string, any> = {}

    // full_name
    if (body.full_name !== undefined) {
      if (typeof body.full_name !== 'string' || body.full_name.trim().length === 0) {
        return NextResponse.json({ error: 'full_name must be a non-empty string' }, { status: 400 })
      }
      update.full_name = body.full_name.trim()
    }

    // telefon
    if (body.telefon !== undefined) {
      if (!isStringOrNullOrUndef(body.telefon)) {
        return NextResponse.json({ error: 'telefon must be a string or null' }, { status: 400 })
      }
      if (typeof body.telefon === 'string') {
        update.telefon = normalizePhone(body.telefon)
      } else {
        update.telefon = body.telefon
      }
    }

    // cif
    if (body.cif !== undefined) {
      if (!isStringOrNullOrUndef(body.cif)) {
        return NextResponse.json({ error: 'cif must be a string or null' }, { status: 400 })
      }
      if (typeof body.cif === 'string') {
        update.cif = normalizeCui(body.cif)
      } else {
        update.cif = body.cif
      }
    }

    // role (DOAR admin)
    if (body.role !== undefined) {
      if (!ctx.isAdmin) {
        return NextResponse.json({ error: 'Forbidden: only admin can update role' }, { status: 403 })
      }
      if (typeof body.role !== 'string' || body.role.trim().length === 0) {
        return NextResponse.json({ error: 'role must be a non-empty string' }, { status: 400 })
      }

      const role = body.role.trim()
      const allowedRoles = new Set(['admin', 'client', 'consultant'])
      if (!allowedRoles.has(role)) {
        return NextResponse.json({ error: `Invalid role. Allowed: ${Array.from(allowedRoles).join(', ')}` }, { status: 400 })
      }

      update.role = role
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'Nothing to update. Allowed fields: full_name, telefon, cif, role (admin only).' },
        { status: 400 }
      )
    }

    const { data, error } = await admin
      .from('profiles')
      .update(update)
      .eq('id', targetUserId)
      .select('id, email, full_name, role, telefon, cif')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // ✅ AUDIT LOG - Modificare utilizator
    // Construim old_values și new_values doar cu câmpurile modificate
    const changedFields = Object.keys(update)
    const roleChanged = update.role !== undefined && oldProfile?.role !== update.role
    const oldValues = roleChanged ? { role: oldProfile?.role ?? null } : null
    const newValues = {
      ...(roleChanged ? { role: update.role } : {}),
      changed_fields: changedFields,
    }

    // Descriere detaliată
    let description = 'A fost modificat un utilizator'
    if (update.role && oldProfile?.role !== update.role) {
      description = `A fost schimbat rolul utilizatorului din "${oldProfile?.role}" în "${update.role}"`
    }

    await logUserAction({
      adminId: ctx.user.id,
      actionType: 'update',
      userId: targetUserId,
      oldValues,
      newValues,
      description,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request)
    })

    return NextResponse.json({ message: 'Profile updated', profile: data })
  } catch (e: any) {
    console.error('PATCH /api/users/[id] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}


export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const ctx = await requireAdmin(request)
    if(!ctx.ok) return guardToResponse(ctx)
    const admin = createSupabaseServiceClient()
    const { userId } = await params

    if (!userId) {
      return NextResponse.json({ error: 'User ID lipsește' }, { status: 400 })
    }
    if (userId === ctx.user.id) {
      return NextResponse.json({ error: 'Self-deactivation is not allowed' }, { status: 400 })
    }

    const { data: userToDelete, error: profileError } = await admin
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', userId)
      .single()
    if (profileError || !userToDelete) {
      return NextResponse.json({ error: 'User not found' }, { status: profileError?.code === 'PGRST116' ? 404 : 500 })
    }
    const wasActive = userToDelete.is_active !== false

    const { error: deactivateError } = await admin
      .from('profiles')
      .update({ is_active: false })
      .eq('id', userId)
    if (deactivateError) {
      console.error('User deactivation failed:', deactivateError)
      return NextResponse.json({ error: 'Unable to disable user access' }, { status: 500 })
    }

    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
    if (banError) {
      await admin.from('profiles').update({ is_active: userToDelete.is_active }).eq('id', userId)
      if (wasActive) {
        const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
        if (unbanError) console.error('User auth unban rollback failed:', unbanError)
      }
      console.error('User auth ban failed:', banError)
      return NextResponse.json({ error: 'Unable to disable user access' }, { status: 500 })
    }

    const queued = await queueDeletionJob(admin, {
      targetType: 'user',
      targetId: userId,
      executeAfter: new Date(),
      requestedBy: ctx.user.id,
      reason: 'manual-deletion-review',
    })
    if (queued.error) {
      await admin.from('profiles').update({ is_active: userToDelete.is_active }).eq('id', userId)
      if (wasActive) {
        const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
        if (unbanError) console.error('User auth unban rollback failed:', unbanError)
      }
      console.error('User deletion review enqueue failed:', queued.error)
      return NextResponse.json({ error: 'Unable to request user deletion review' }, { status: 500 })
    }

    await logUserAction({
      adminId: ctx.user.id,
      actionType: 'delete',
      userId,
      oldValues: { role: userToDelete.role, is_active: userToDelete.is_active },
      newValues: { is_active: false, deletion_requested: true },
      description: 'Accesul utilizatorului a fost dezactivat; ștergerea necesită verificare manuală.',
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
    })

    return NextResponse.json(
      { deletion_requested: true, access_disabled: true, manual_review_required: true },
      { status: 202 },
    )

  } catch (error: any) {
    console.error('User deletion request failed:', error)
    return NextResponse.json({ error: 'Unable to request user deletion' }, { status: 500 })
  }
}
