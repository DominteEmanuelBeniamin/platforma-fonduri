import { NextResponse } from 'next/server'
import { guardToResponse, requireAdmin } from '../../../_utils/auth'
import { createSupabaseServiceClient } from '../../../_utils/supabase'
import { userLifecycleConflict } from '../../../_utils/user-lifecycle'
import { isUuid } from '@/lib/notification-utils'
import { isRoleImpact, roleImpactRequest } from '@/lib/user-role-impact'

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)
    const { userId } = await params
    if (!isUuid(userId)) return NextResponse.json({ message: 'Utilizatorul nu a fost găsit.' }, { status: 404 })
    const input = roleImpactRequest(await request.json().catch(() => null))
    if (!input) return NextResponse.json({ message: 'Operațiunea nu este validă.' }, { status: 400 })
    const admin = createSupabaseServiceClient()
    const { data, error } = await admin.rpc('user_role_change_impact', {
      p_target_id: userId, p_actor_id: ctx.user.id, p_changes: input.changes,
    })
    if (error) {
      const conflict = userLifecycleConflict(error)
      if (conflict) return NextResponse.json(conflict.body, { status: conflict.status })
      console.error('Role impact failed:', { code: error.code })
      return NextResponse.json({ message: 'Nu am putut verifica impactul.' }, { status: 500 })
    }
    if (!isRoleImpact(data, userId)) {
      return NextResponse.json({ message: 'Nu am putut verifica impactul.' }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error('Role impact error:', { code: error && typeof error === 'object' && 'code' in error ? error.code : 'unknown' })
    return NextResponse.json({ message: 'Nu am putut verifica impactul.' }, { status: 500 })
  }
}
