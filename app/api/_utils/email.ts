// app/api/_utils/email.ts
import { isValidReminderEmail } from '@/lib/reminder-email'

export { isValidReminderEmail }

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Elimină CR/LF dintr-un text destinat unui header de email (ex. subject),
// ca să nu poată fi folosit pentru header injection.
export function sanitizeHeaderText(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

// Adresa de expediere, într-un singur loc — altfel fiecare rută își alege propriul
// fallback și aceeași variabilă de mediu ajunge să însemne lucruri diferite.
// Emailurile către clienți pot pleca de pe o adresă separată
// (RESEND_CLIENT_NOTIFICATION_FROM_EMAIL); restul folosesc RESEND_FROM_EMAIL.
// Fallback-ul final e domeniul sandbox Resend, care trimite fără domeniu verificat —
// în producție se setează variabilele pe domeniul propriu.
export function resendFromAddress(audience: 'client' | 'internal' = 'internal') {
  if (audience === 'client' && process.env.RESEND_CLIENT_NOTIFICATION_FROM_EMAIL) {
    return process.env.RESEND_CLIENT_NOTIFICATION_FROM_EMAIL
  }
  return process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
}

export type ReminderDelivery = {
  intendedEmail: string
  deliveryEmail: string
  overridden: boolean
}

export type ReminderDeliveryError = {
  code: 'invalid_email' | 'configuration'
  message: string
}

function isProductionEnvironment() {
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase()
  if (vercelEnvironment) return vercelEnvironment === 'production'
  return process.env.NODE_ENV === 'production'
}

export function resolveReminderDelivery(
  intendedEmail: unknown,
): { ok: true; data: ReminderDelivery } | { ok: false; error: ReminderDeliveryError } {
  const override = process.env.REMINDER_EMAIL_OVERRIDE_TO?.trim() ?? ''
  if (override && isProductionEnvironment()) {
    return {
      ok: false,
      error: {
        code: 'configuration',
        message: 'REMINDER_EMAIL_OVERRIDE_TO nu este permis în producție.',
      },
    }
  }
  if (override && !isValidReminderEmail(override)) {
    return {
      ok: false,
      error: {
        code: 'configuration',
        message: 'REMINDER_EMAIL_OVERRIDE_TO nu este un email valid.',
      },
    }
  }
  if (!override && !isProductionEnvironment()) {
    return {
      ok: false,
      error: {
        code: 'configuration',
        message: 'REMINDER_EMAIL_OVERRIDE_TO este obligatoriu în development și preview.',
      },
    }
  }
  if (!isValidReminderEmail(intendedEmail)) {
    return {
      ok: false,
      error: {
        code: 'invalid_email',
        message: 'Destinatarul nu are un email valid.',
      },
    }
  }
  const normalizedIntendedEmail = intendedEmail.trim()
  return {
    ok: true,
    data: {
      intendedEmail: normalizedIntendedEmail,
      deliveryEmail: override || normalizedIntendedEmail,
      overridden: Boolean(override),
    },
  }
}
