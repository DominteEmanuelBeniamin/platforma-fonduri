import { Resend } from 'resend'
import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '../../../_utils/auth'
import { createSupabaseServiceClient } from '../../../_utils/supabase'
import { isValidReminderEmail, resendFromAddress, sanitizeHeaderText } from '../../../_utils/email'
import { logAction } from '../../../_utils/audit'
import { isPasswordResetTargetRole, renderPasswordChangedSecurityEmail, type PasswordResetTargetRole } from '@/lib/password-reset'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function sendSecurityEmail(target: {
  email: string | null
  full_name: string | null
  role: PasswordResetTargetRole
}) {
  if (!isValidReminderEmail(target.email)) {
    return { sent: false, error: 'Utilizatorul nu are un email valid.' }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return { sent: false, error: 'RESEND_API_KEY nu este configurat.' }

  const rendered = renderPasswordChangedSecurityEmail({ targetName: target.full_name })

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: resendFromAddress(target.role === 'client' ? 'client' : 'internal'),
      to: target.email.trim(),
      subject: sanitizeHeaderText(rendered.subject),
      text: rendered.text,
      html: rendered.html,
    })

    if (error) return { sent: false, error: error.message || 'Emailul nu a putut fi trimis.' }
    return { sent: true, error: null }
  } catch (error) {
    console.error('[password_reset] security email failed:', error)
    return { sent: false, error: 'Emailul nu a putut fi trimis.' }
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const { userId } = await params
    if (!userId) return NextResponse.json({ error: 'User ID lipsește din URL' }, { status: 400 })

    const body = await request.json().catch(() => null)
    const password = isRecord(body) ? body.password : null
    if (typeof password !== 'string' || password.length === 0) {
      return NextResponse.json({ error: 'password trebuie să fie un string ne-gol' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()
    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', userId)
      .maybeSingle()

    if (targetError) {
      console.error('[password_reset] target lookup failed:', targetError.message)
      return NextResponse.json({ error: 'Nu am putut încărca utilizatorul.' }, { status: 500 })
    }
    if (!target) return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 })
    if (!isPasswordResetTargetRole(target.role)) {
      return NextResponse.json({ error: 'Parola poate fi resetată doar pentru clienți și consultanți.' }, { status: 400 })
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password })
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    await logAction({
      actorId: ctx.user.id,
      actionType: 'update',
      entityType: 'user',
      entityId: userId,
      entityName: target.email,
      newValues: { password_reset: true },
      description: `${ctx.profile.email || 'Admin'} a schimbat parola utilizatorului ${target.email}`,
      request,
    })

    const securityEmail = await sendSecurityEmail(target)
    if (!securityEmail.sent) {
      console.error('[password_reset] password changed but security email failed:', {
        targetUserId: userId,
        error: securityEmail.error,
      })
      return NextResponse.json({
        message: 'Parola a fost schimbată cu succes.',
        notificationSent: false,
        warning: 'Parola a fost schimbată, dar emailul de securitate nu a putut fi trimis.',
      })
    }

    return NextResponse.json({
      message: 'Parola a fost schimbată cu succes.',
      notificationSent: true,
    })
  } catch (error) {
    console.error('PATCH /api/users/[userId]/password error:', error)
    return NextResponse.json({ error: 'Eroare internă la schimbarea parolei.' }, { status: 500 })
  }
}
