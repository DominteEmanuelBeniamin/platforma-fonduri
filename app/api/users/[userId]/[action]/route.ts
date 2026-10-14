import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { getClientIP, getUserAgent } from '@/app/api/_utils/audit'
import { userLifecycleConflict } from '@/app/api/_utils/user-lifecycle'
import { isUuid } from '@/lib/notification-utils'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string; action: string }> },
) {
  try {
    const { userId, action } = await params
    if (!isUuid(userId)) {
      return NextResponse.json({ error: 'User ID trebuie să fie UUID valid' }, { status: 400 })
    }
    if (action !== 'deactivate' && action !== 'reactivate') {
      return NextResponse.json({ error: 'Acțiune necunoscută.' }, { status: 404 })
    }

    const actor = await requireAdmin(request)
    if (!actor.ok) return guardToResponse(actor)

    const active = action === 'reactivate'
    const admin = createSupabaseServiceClient()
    const { data, error } = await admin.rpc('set_user_account_active', {
      p_target_id: userId,
      p_actor_id: actor.user.id,
      p_active: active,
      p_ip_address: getClientIP(request),
      p_user_agent: getUserAgent(request),
    })
    if (error) {
      const conflict = userLifecycleConflict(error)
      if (conflict) return NextResponse.json(conflict.body, { status: conflict.status })
      console.error('Account lifecycle RPC failed:', error)
      return NextResponse.json({ error: 'Nu am putut schimba starea contului.' }, { status: 500 })
    }

    const profile = data?.profile
    const changed = data?.changed
    const authSynced = data?.authSynced
    if (!profile || profile.id !== userId || typeof profile.is_active !== 'boolean'
      || typeof profile.auth_sync_pending !== 'boolean' || typeof changed !== 'boolean'
      || typeof authSynced !== 'boolean') {
      console.error('Account lifecycle RPC returned an invalid result:', { userId, action })
      return NextResponse.json({ error: 'Nu am putut confirma starea contului.' }, { status: 500 })
    }

    if (!authSynced) {
      if (profile.is_active !== false || profile.auth_sync_pending !== true) {
        console.error('Incomplete auth sync returned an inconsistent profile:', { userId, action })
        return NextResponse.json({ error: 'Nu am putut confirma starea contului.' }, { status: 500 })
      }
      return NextResponse.json({
        code: 'AUTH_SYNC_INCOMPLETE',
        error: 'Starea contului a fost schimbată, dar sincronizarea autentificării trebuie reîncercată.',
        profile,
        changed,
        authSynced: false,
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }

    if (profile.is_active !== active || profile.auth_sync_pending) {
      console.error('Account lifecycle RPC returned an inconsistent successful profile:', { userId, action })
      return NextResponse.json({ error: 'Nu am putut confirma starea contului.' }, { status: 500 })
    }

    return NextResponse.json({ profile, changed, authSynced: true }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('POST user lifecycle error:', error)
    return NextResponse.json({ error: 'Nu am putut schimba starea contului.' }, { status: 500 })
  }
}
