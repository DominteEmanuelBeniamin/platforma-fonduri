import { isValidReminderEmail } from './reminder-email.ts'

export const PASSWORD_RESET_COOLDOWN_MS = 15 * 60 * 1000

export const GENERIC_PASSWORD_RESET_MESSAGE =
  'Dacă emailul aparține unui cont eligibil, administratorii vor fi notificați.'

export type PasswordResetTargetRole = 'client' | 'consultant'

export function normalizePasswordResetEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized.length > 254 || !isValidReminderEmail(normalized)) return null
  return normalized
}

export function isPasswordResetTargetRole(value: unknown): value is PasswordResetTargetRole {
  return value === 'client' || value === 'consultant'
}

export function passwordResetAdminDeliveryRecipients(
  intendedRecipients: string[],
  options: { production: boolean; developmentOverride?: string },
) {
  if (options.production) return intendedRecipients
  const override = normalizePasswordResetEmail(options.developmentOverride)
  return override ? [override] : []
}

/** Escapează metacaracterele LIKE înainte de a fi folosite într-un filtru PostgREST ilike. */
export function escapePasswordResetIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

export function buildPasswordResetAdminUrl(appUrl: string, userId: string) {
  const base = new URL(appUrl)
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_APP_URL trebuie să folosească http sau https')
  }

  return new URL(`/admin/users/${encodeURIComponent(userId)}`, base).toString()
}

function safeDisplayText(value: string | null | undefined, fallback: string) {
  const text = (value || fallback).replace(/[\r\n]+/g, ' ').trim()
  return text || fallback
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeSubject(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export type RenderedPasswordResetEmail = {
  subject: string
  text: string
  html: string
}

export function renderPasswordResetAdminEmail(input: {
  targetName?: string | null
  targetEmail: string
  targetRole: PasswordResetTargetRole
  requestedAt: string
  adminUrl: string
}): RenderedPasswordResetEmail {
  const targetName = safeDisplayText(input.targetName, input.targetEmail)
  const targetEmail = safeDisplayText(input.targetEmail, 'email necunoscut')
  const targetRole = input.targetRole === 'client' ? 'Client' : 'Consultant'
  const requestedAt = safeDisplayText(input.requestedAt, 'moment necunoscut')
  const adminUrl = input.adminUrl

  return {
    subject: safeSubject(`Solicitare resetare parolă: ${targetEmail}`),
    text: [
      'Un client sau consultant a solicitat resetarea parolei.',
      '',
      `Utilizator: ${targetName}`,
      `Email: ${targetEmail}`,
      `Rol: ${targetRole}`,
      `Solicitat la: ${requestedAt}`,
      '',
      'Verifică identitatea utilizatorului conform procedurii interne, apoi setează parola din pagina de administrare:',
      adminUrl,
      '',
      'Parola nu este inclusă în acest email.',
    ].join('\n'),
    html: '<!doctype html><html lang="ro"><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1e293b;line-height:1.5;">' +
      `<h2>Solicitare resetare parolă</h2><p>Un client sau consultant a solicitat resetarea parolei.</p>` +
      `<dl><dt><strong>Utilizator</strong></dt><dd>${escapeHtml(targetName)}</dd><dt><strong>Email</strong></dt><dd>${escapeHtml(targetEmail)}</dd><dt><strong>Rol</strong></dt><dd>${escapeHtml(targetRole)}</dd><dt><strong>Solicitat la</strong></dt><dd>${escapeHtml(requestedAt)}</dd></dl>` +
      `<p><a href="${escapeHtml(adminUrl)}">Deschide pagina utilizatorului</a></p>` +
      '<p>Verifică identitatea utilizatorului conform procedurii interne. Parola nu este inclusă în acest email.</p>' +
      '</body></html>',
  }
}

export function renderPasswordChangedSecurityEmail(input: {
  targetName?: string | null
}): RenderedPasswordResetEmail {
  const targetName = safeDisplayText(input.targetName, 'utilizatorule')

  return {
    subject: safeSubject('Parola contului tău a fost schimbată'),
    text: [
      `Bună, ${targetName},`,
      '',
      'Parola contului tău a fost schimbată de un administrator.',
      'Dacă nu ai solicitat această schimbare sau ai nelămuriri, contactează administratorii platformei.',
      '',
      'Din motive de securitate, parola nu este inclusă în acest email.',
    ].join('\n'),
    html: '<!doctype html><html lang="ro"><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1e293b;line-height:1.5;">' +
      `<p>Bună, ${escapeHtml(targetName)},</p>` +
      '<p>Parola contului tău a fost schimbată de un administrator.</p>' +
      '<p>Dacă nu ai solicitat această schimbare sau ai nelămuriri, contactează administratorii platformei.</p>' +
      '<p>Din motive de securitate, parola nu este inclusă în acest email.</p>' +
      '</body></html>',
  }
}
