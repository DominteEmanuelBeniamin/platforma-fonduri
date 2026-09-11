import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '../../_utils/auth'
import { getClientIP, getUserAgent, logAction } from '../../_utils/audit'

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

    const { user } = ctx

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

    await logAction({
      actorId: user.id,
      actionType: action as 'login' | 'logout',
      entityType: 'user',
      entityId: user.id,
      entityName: `user:${user.id}`,
      description: action === 'login'
        ? 'Utilizatorul s-a autentificat'
        : 'Utilizatorul s-a deconectat',
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
    })

    return NextResponse.json({ ok: true })

  } catch (e: unknown) {
    const error = e as Error
    console.error('POST /api/auth/audit error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}
