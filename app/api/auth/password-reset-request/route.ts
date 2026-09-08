import { Resend } from 'resend'
import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '../../_utils/supabase'
import {
  isProductionEnvironment,
  isValidReminderEmail,
  resendFromAddress,
  sanitizeHeaderText,
} from '../../_utils/email'
import {
  buildPasswordResetAdminUrl,
  GENERIC_PASSWORD_RESET_MESSAGE,
  escapePasswordResetIlikePattern,
  isPasswordResetTargetRole,
  normalizePasswordResetEmail,
  PASSWORD_RESET_COOLDOWN_MS,
  passwordResetAdminDeliveryRecipients,
  renderPasswordResetAdminEmail,
} from '@/lib/password-reset'

const GENERIC_RESPONSE = { message: GENERIC_PASSWORD_RESET_MESSAGE }

function genericResponse() {
  return NextResponse.json(GENERIC_RESPONSE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getConfiguredAppUrl() {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!value) throw new Error('Missing env: NEXT_PUBLIC_APP_URL')
  return value
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const email = normalizePasswordResetEmail(isRecord(body) ? body.email : null)
    if (!email) return genericResponse()

    const apiKey = process.env.RESEND_API_KEY?.trim()
    if (!apiKey) {
      console.error('[password_reset_request] RESEND_API_KEY is not configured')
      return genericResponse()
    }

    const appUrl = getConfiguredAppUrl()
    const admin = createSupabaseServiceClient()
    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, email, full_name, role, is_active')
      .ilike('email', escapePasswordResetIlikePattern(email))
      .eq('is_active', true)
      .maybeSingle()

    if (targetError) {
      console.error('[password_reset_request] target lookup failed:', targetError.message)
      return genericResponse()
    }

    if (!target || !isPasswordResetTargetRole(target.role)) return genericResponse()

    const adminUrl = buildPasswordResetAdminUrl(appUrl, target.id)
    const { data: admins, error: adminsError } = await admin
      .from('profiles')
      .select('email')
      .eq('role', 'admin')
      .eq('is_active', true)

    if (adminsError) {
      console.error('[password_reset_request] admin lookup failed:', adminsError.message)
      return genericResponse()
    }

    const recipients = (admins ?? [])
      .map((row) => (typeof row.email === 'string' ? row.email.trim() : ''))
      .filter((value, index, rows) => isValidReminderEmail(value) && rows.indexOf(value) === index)

    if (recipients.length === 0) return genericResponse()

    const developmentOverride = process.env.PASSWORD_RESET_ADMIN_EMAIL_OVERRIDE_TO?.trim() ?? ''
    const deliveryRecipients = passwordResetAdminDeliveryRecipients(recipients, {
      production: isProductionEnvironment(),
      developmentOverride,
    })

    if (deliveryRecipients.length === 0) {
      console.error('[password_reset_request] PASSWORD_RESET_ADMIN_EMAIL_OVERRIDE_TO lipsește sau nu este valid în development/preview')
      return genericResponse()
    }

    const now = new Date()
    const requestedAt = now.toISOString()
    const cooldownCutoff = new Date(now.getTime() - PASSWORD_RESET_COOLDOWN_MS).toISOString()

    // UPDATE-ul condiționat este atomic: două solicitări concurente pentru
    // același cont nu pot primi ambele claim-ul în aceeași fereastră.
    const { data: claim, error: claimError } = await admin
      .from('profiles')
      .update({ password_reset_requested_at: requestedAt })
      .eq('id', target.id)
      .or(`password_reset_requested_at.is.null,password_reset_requested_at.lt.${cooldownCutoff}`)
      .select('id')
      .maybeSingle()

    if (claimError) {
      console.error('[password_reset_request] cooldown claim failed:', claimError.message)
      return genericResponse()
    }

    if (!claim) return genericResponse()

    const rendered = renderPasswordResetAdminEmail({
      targetName: target.full_name,
      targetEmail: typeof target.email === 'string' ? target.email : email,
      targetRole: target.role,
      requestedAt,
      adminUrl,
    })
    const resend = new Resend(apiKey)
    const results = await Promise.allSettled(
      deliveryRecipients.map((recipient) =>
        resend.emails.send({
          from: resendFromAddress(),
          to: recipient,
          subject: sanitizeHeaderText(rendered.subject),
          text: rendered.text,
          html: rendered.html,
        }),
      ),
    )
    const failed = results.filter((result) => result.status === 'rejected').length +
      results.filter((result) => result.status === 'fulfilled' && Boolean(result.value.error)).length

    if (failed > 0) {
      console.error('[password_reset_request] admin email delivery failed:', {
        targetUserId: target.id,
        intendedRecipientCount: recipients.length,
        deliveryRecipientCount: deliveryRecipients.length,
        failed,
      })
    }

    if (failed === deliveryRecipients.length) {
      const { error: releaseError } = await admin
        .from('profiles')
        .update({ password_reset_requested_at: null })
        .eq('id', target.id)
        .eq('password_reset_requested_at', requestedAt)
      if (releaseError) {
        console.error('[password_reset_request] cooldown release failed:', releaseError.message)
      }
    }

    return genericResponse()
  } catch (error) {
    console.error('[password_reset_request] unexpected error:', error)
    return genericResponse()
  }
}
