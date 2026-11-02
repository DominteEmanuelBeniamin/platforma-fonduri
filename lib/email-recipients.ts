import { isValidReminderEmail } from './reminder-email.ts'

// Destinatarii unui document trimis pe email: oricine, cu sau fără cont în
// platformă (ANAF, contabilul, banca). Se scriu despărțiți prin virgulă,
// punct și virgulă, spațiu sau rând nou; dublurile se trimit o singură dată.

export const MAX_EMAIL_RECIPIENTS = 5
// Resend primește cel mult 40 MB pe email, cu atașamentele codate base64 (+33%).
export const MAX_EMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024

export function parseEmailRecipients(text: unknown): { ok: true; emails: string[] } | { ok: false; message: string } {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, message: 'Scrie cel puțin o adresă de email.' }
  const parts = text.split(/[\s,;]+/).map(part => part.trim().replace(/^<|>$/g, '')).filter(Boolean)
  const invalid = parts.find(part => !isValidReminderEmail(part) || part.length > 254)
  if (invalid) return { ok: false, message: `„${invalid}” nu e o adresă de email validă.` }
  const emails = [...new Map(parts.map(part => [part.toLowerCase(), part])).values()]
  if (emails.length > MAX_EMAIL_RECIPIENTS) return { ok: false, message: `Cel mult ${MAX_EMAIL_RECIPIENTS} adrese într-un email.` }
  return { ok: true, emails }
}
