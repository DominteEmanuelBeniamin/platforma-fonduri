import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createSupabaseServiceClient } from './supabase'
import { logAction } from './audit'
import { escapeHtml, resendFromAddress, resolveReminderDelivery, sanitizeHeaderText } from './email'
import { MAX_EMAIL_ATTACHMENT_BYTES, parseEmailRecipients } from '@/lib/email-recipients'

// „Trimite pe email”: oricine poate citi un document îl poate trimite oricui
// (ANAF, contabil, bancă), ca atașament. Emailul pleacă din platformă, dar
// răspunsul ajunge la cel care l-a trimis (Reply-To), care primește și o copie.
// Comun pentru fișierele încărcate și pentru atașamentele cererilor (modele,
// documente trimise clientului); drepturile le verifică ruta fiecăruia.

const BUCKET = 'project-files'
const DAILY_LIMIT_PER_USER = 30
const TOO_LARGE = 'Fișierul are peste 25 MB și nu încape într-un email. Descarcă-l și trimite-l printr-un serviciu de transfer.'

export type DocumentEmailForm = { recipients: string[]; subject: string; message: string; copyToMe: boolean }

export type EmailableDocument = {
  actorId: string
  actorEmail: string | null
  storagePath: string
  fileName: string
  mimeType: string | null
  size: number | null
  projectId: string
  projectTitle: string
  documentName: string | null
  entityType: string
  entityId: string
  auditValues: Record<string, unknown>
}

export function documentEmailReply(status: number, code: string, message: string) {
  return NextResponse.json({ code, error: message, message }, { status })
}

/** Formularul, verificat înainte să citim documentul: o greșeală de tastare nu costă nimic. */
export function parseDocumentEmailForm(body: unknown): { ok: true; form: DocumentEmailForm } | { ok: false; response: Response } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, response: documentEmailReply(400, 'invalid_request', 'Cererea nu e validă.') }
  }
  const { to, subject, message, copyToMe } = body as Record<string, unknown>
  const recipients = parseEmailRecipients(to)
  if (!recipients.ok) return { ok: false, response: documentEmailReply(400, 'invalid_recipients', recipients.message) }
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) {
    return { ok: false, response: documentEmailReply(400, 'invalid_subject', 'Scrie un subiect de cel mult 200 de caractere.') }
  }
  if (message !== undefined && (typeof message !== 'string' || message.length > 5000)) {
    return { ok: false, response: documentEmailReply(400, 'invalid_message', 'Mesajul poate avea cel mult 5000 de caractere.') }
  }
  return {
    ok: true,
    form: { recipients: recipients.emails, subject: subject.trim(), message: typeof message === 'string' ? message.trim() : '', copyToMe: copyToMe !== false },
  }
}

export async function deliverDocumentEmail(request: Request, form: DocumentEmailForm, doc: EmailableDocument): Promise<Response> {
  const admin = createSupabaseServiceClient()
  if (typeof doc.size === 'number' && doc.size > MAX_EMAIL_ATTACHMENT_BYTES) return documentEmailReply(413, 'too_large', TOO_LARGE)

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count, error: countError } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', doc.actorId)
    .eq('action_type', 'email_send')
    .gte('created_at', since)
  if (countError) {
    console.error('email_send rate lookup failed:', countError)
    return documentEmailReply(503, 'temporarily_unavailable', 'Nu am putut trimite emailul acum. Încearcă din nou peste câteva minute.')
  }
  if ((count ?? 0) >= DAILY_LIMIT_PER_USER) {
    return documentEmailReply(429, 'rate_limited', `Ai trimis deja ${DAILY_LIMIT_PER_USER} documente pe email în ultimele 24 de ore. Încearcă mai târziu.`)
  }

  const { data: sender } = await admin.from('profiles').select('full_name, email').eq('id', doc.actorId).maybeSingle()
  const senderEmail = sender?.email ?? doc.actorEmail
  const senderName = sender?.full_name?.trim() || senderEmail || 'Un utilizator Bonie'

  // În dezvoltare și preview, `resolveReminderDelivery` trimite totul la adresa de test
  // (REMINDER_EMAIL_OVERRIDE_TO); fără ea nu pleacă nimic.
  const deliveries = form.recipients.map(email => resolveReminderDelivery(email))
  const refused = deliveries.find(delivery => !delivery.ok)
  if (refused && !refused.ok) {
    console.error('email_send delivery not configured:', refused.error.code)
    return documentEmailReply(503, 'not_configured', 'Trimiterea emailurilor nu e configurată pe acest server.')
  }
  const to = [...new Set(deliveries.map(delivery => (delivery.ok ? delivery.data.deliveryEmail : '')))]
  const ccDelivery = form.copyToMe && senderEmail ? resolveReminderDelivery(senderEmail) : null
  const cc = ccDelivery?.ok && !to.includes(ccDelivery.data.deliveryEmail) ? [ccDelivery.data.deliveryEmail] : undefined

  const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(doc.storagePath)
  if (downloadError || !blob) {
    console.error('email_send storage download failed:', downloadError)
    return documentEmailReply(503, 'temporarily_unavailable', 'Nu am putut citi fișierul. Încearcă din nou.')
  }
  if (blob.size > MAX_EMAIL_ATTACHMENT_BYTES) return documentEmailReply(413, 'too_large', TOO_LARGE)

  const footer = `Trimis de ${senderName}${senderEmail && senderEmail !== senderName ? ` (${senderEmail})` : ''} prin Bonie.`
    + (senderEmail ? ` Răspunsul tău ajunge direct la ${senderEmail}.` : '')
  const html = (form.message ? form.message.split(/\n{2,}/).map(paragraph => '<p>' + escapeHtml(paragraph).replace(/\n/g, '<br>') + '</p>').join('') : '')
    + '<p>Documentul <strong>' + escapeHtml(doc.fileName) + '</strong> este atașat.</p>'
    + '<p style="color:#6b7280;font-size:12px">' + escapeHtml(footer) + '</p>'
  const text = (form.message ? form.message + '\n\n' : '') + 'Documentul „' + doc.fileName + '” este atașat.\n\n' + footer

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data: sent, error: sendError } = await resend.emails.send({
    from: resendFromAddress(),
    to,
    ...(cc ? { cc } : {}),
    ...(senderEmail ? { replyTo: senderEmail } : {}),
    subject: sanitizeHeaderText(form.subject),
    html,
    text,
    attachments: [{
      filename: doc.fileName,
      content: Buffer.from(await blob.arrayBuffer()),
      ...(doc.mimeType ? { contentType: doc.mimeType } : {}),
    }],
  })
  if (sendError) {
    console.error('email_send provider rejected:', sendError)
    return documentEmailReply(502, 'provider_rejected', 'Furnizorul de email a refuzat mesajul. Verifică adresele și încearcă din nou.')
  }

  await logAction({
    actorId: doc.actorId,
    actionType: 'email_send',
    entityType: doc.entityType,
    entityId: doc.entityId,
    entityName: doc.fileName,
    newValues: {
      ...doc.auditValues,
      project_id: doc.projectId,
      project_title: doc.projectTitle,
      document_request_name: doc.documentName,
      recipients: form.recipients,
      copy_to_sender: !!cc,
      subject: form.subject,
      provider_id: sent?.id ?? null,
    },
    description: `${senderEmail ?? senderName} a trimis pe email documentul "${doc.fileName}" din proiectul "${doc.projectTitle}" către ${form.recipients.join(', ')}`,
    request,
  })

  return NextResponse.json({ status: 'sent', recipients: form.recipients, copyToMe: !!cc })
}
