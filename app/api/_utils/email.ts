// app/api/_utils/email.ts

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
