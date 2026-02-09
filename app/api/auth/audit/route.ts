import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '../../_utils/auth'
import { createSupabaseServiceClient } from '../../_utils/supabase'

/**
 * POST /api/auth/audit
 * 
 * Body: { action: 'login' | 'logout' }
 * 
 * Înregistrează în audit_logs acțiunile de login/logout ale utilizatorilor.
 */
export async function POST(request: Request) {
  try {
    // Verificăm autentificarea
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const { user, profile } = ctx

    // Parsăm body-ul
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { action } = body as { action?: unknown }

    // Validăm acțiunea
    if (typeof action !== 'string' || !['login', 'logout'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "login" or "logout"' },
        { status: 400 }
      )
    }

    const admin = createSupabaseServiceClient()

    // Obținem IP-ul utilizatorului
    const ipAddress = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      null

    // Înregistrăm în audit_logs
    const { error: auditError } = await admin
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action_type: action as 'login' | 'logout',
        entity_type: 'user',
        entity_id: user.id,
        entity_name: profile.email || user.email,
        description: action === 'login' 
          ? `${profile.email || user.email} s-a autentificat` 
          : `${profile.email || user.email} s-a deconectat`,
        ip_address: ipAddress
      })

    if (auditError) {
      console.error('Audit log error:', auditError)
      // Nu returnăm eroare la client, doar logăm
    }

    return NextResponse.json({ ok: true })

  } catch (e: unknown) {
    const error = e as Error
    console.error('POST /api/auth/audit error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}