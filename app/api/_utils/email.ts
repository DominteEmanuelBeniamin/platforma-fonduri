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
