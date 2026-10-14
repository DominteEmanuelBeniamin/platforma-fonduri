import { NextResponse } from 'next/server'
import { guardToResponse, requireProfile } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'

export async function GET(request: Request) {
  try {
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)
    if (ctx.profile.role !== 'admin' && ctx.profile.role !== 'consultant') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const state = new URL(request.url).searchParams.get('state') ?? 'active'
    if (!['active', 'inactive', 'all'].includes(state)) {
      return NextResponse.json({ error: 'state trebuie să fie active, inactive sau all' }, { status: 400 })
    }
    if (ctx.profile.role !== 'admin' && state !== 'active') {
      return NextResponse.json({ error: 'Doar adminii pot lista clienți inactivi' }, { status: 403 })
    }

    const admin = createSupabaseServiceClient()
    let query = admin
      .from('profiles')
      .select('id, email, full_name, nume_firma, cif, is_active')
      .eq('role', 'client')
    if (state === 'active') query = query.or('is_active.is.null,is_active.eq.true')
    if (state === 'inactive') query = query.eq('is_active', false)
    const { data, error } = await query.order('full_name')
    if (error) throw error

    return NextResponse.json({ clients: data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 400 },
    )
  }
}
