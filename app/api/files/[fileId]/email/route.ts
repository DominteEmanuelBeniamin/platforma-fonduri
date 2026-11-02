import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { logAction } from '@/app/api/_utils/audit'
import { readableFile } from '@/app/api/_utils/file-access'
import { escapeHtml, resendFromAddress, resolveReminderDelivery, sanitizeHeaderText } from '@/app/api/_utils/email'
import { MAX_EMAIL_ATTACHMENT_BYTES, parseEmailRecipients } from '@/lib/email-recipients'

// „Trimite pe email”: oricine poate citi fișierul îl poate trimite oricui
// (ANAF, contabil, bancă), ca atașament. Emailul pleacă din platformă, dar
// răspunsul ajunge la cel care l-a trimis (Reply-To), care primește și o copie.

export const maxDuration = 60

const BUCKET = 'project-files'
const DAILY_LIMIT_PER_USER = 30

function reply(status: number, code: string, message: string) {
  return NextResponse.json({ code, error: message, message }, { status })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, 'invalid_request', 'Cererea nu e validă.')
    const { to: recipientText, subject, message, copyToMe } = body as Record<string, unknown>

    const recipients = parseEmailRecipients(recipientText)
    if (!recipients.ok) return reply(400, 'invalid_recipients', recipients.message)
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) {
      return reply(400, 'invalid_subject', 'Scrie un subiect de cel mult 200 de caractere.')
    }
    if (message !== undefined && (typeof message !== 'string' || message.length > 5000)) {
      return reply(400, 'invalid_message', 'Mesajul poate avea cel mult 5000 de caractere.')
    }

    const readable = await readableFile(request, fileId)
    if (!readable.ok) return readable.response
    const { access, file, fileName, projectId, projectTitle, requirementName } = readable.value
    const admin = createSupabaseServiceClient()

    if (typeof file.file_size === 'number' && file.file_size > MAX_EMAIL_ATTACHMENT_BYTES) {
      return reply(413, 'too_large', 'Fișierul are peste 25 MB și nu încape într-un email. Descarcă-l și trimite-l printr-un serviciu de transfer.')
    }

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count, error: countError } = await admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', access.user.id)
      .eq('action_type', 'email_send')
      .gte('created_at', since)
    if (countError) {
      console.error('email_send rate lookup failed:', countError)
      return reply(503, 'temporarily_unavailable', 'Nu am putut trimite emailul acum. Încearcă din nou peste câteva minute.')
    }
    if ((count ?? 0) >= DAILY_LIMIT_PER_USER) {
      return reply(429, 'rate_limited', `Ai trimis deja ${DAILY_LIMIT_PER_USER} documente pe email în ultimele 24 de ore. Încearcă mai târziu.`)
    }

    const { data: sender } = await admin.from('profiles').select('full_name, email').eq('id', access.user.id).maybeSingle()
    const senderEmail = sender?.email ?? access.profile.email ?? null
    const senderName = sender?.full_name?.trim() || senderEmail || 'Un utilizator Bonie'

    // În dezvoltare și preview, `resolveReminderDelivery` trimite totul la adresa de test
    // (REMINDER_EMAIL_OVERRIDE_TO); fără ea nu pleacă nimic.
    const deliveries = recipients.emails.map(email => resolveReminderDelivery(email))
    const refused = deliveries.find(delivery => !delivery.ok)
    if (refused && !refused.ok) {
      console.error('email_send delivery not configured:', refused.error.code)
      return reply(503, 'not_configured', 'Trimiterea emailurilor nu e configurată pe acest server.')
    }
    const to = [...new Set(deliveries.map(delivery => (delivery.ok ? delivery.data.deliveryEmail : '')))]
    const ccDelivery = copyToMe !== false && senderEmail ? resolveReminderDelivery(senderEmail) : null
    const cc = ccDelivery?.ok && !to.includes(ccDelivery.data.deliveryEmail) ? [ccDelivery.data.deliveryEmail] : undefined

    const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(file.storage_path)
    if (downloadError || !blob) {
      console.error('email_send storage download failed:', downloadError)
      return reply(503, 'temporarily_unavailable', 'Nu am putut citi fișierul. Încearcă din nou.')
    }
    if (blob.size > MAX_EMAIL_ATTACHMENT_BYTES) {
      return reply(413, 'too_large', 'Fișierul are peste 25 MB și nu încape într-un email. Descarcă-l și trimite-l printr-un serviciu de transfer.')
    }

    const note = typeof message === 'string' ? message.trim() : ''
    const footer = `Trimis de ${senderName}${senderEmail && senderEmail !== senderName ? ` (${senderEmail})` : ''} prin Bonie.`
      + (senderEmail ? ` Răspunsul tău ajunge direct la ${senderEmail}.` : '')
    const html = (note ? note.split(/\n{2,}/).map(paragraph => '<p>' + escapeHtml(paragraph).replace(/\n/g, '<br>') + '</p>').join('') : '')
      + '<p>Documentul <strong>' + escapeHtml(fileName) + '</strong> este atașat.</p>'
      + '<p style="color:#6b7280;font-size:12px">' + escapeHtml(footer) + '</p>'
    const text = (note ? note + '\n\n' : '') + 'Documentul „' + fileName + '” este atașat.\n\n' + footer

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data: sent, error: sendError } = await resend.emails.send({
      from: resendFromAddress(),
      to,
      ...(cc ? { cc } : {}),
      ...(senderEmail ? { replyTo: senderEmail } : {}),
      subject: sanitizeHeaderText(subject.trim()),
      html,
      text,
      attachments: [{
        filename: fileName,
        content: Buffer.from(await blob.arrayBuffer()),
        ...(file.mime_type ? { contentType: file.mime_type } : {}),
      }],
    })
    if (sendError) {
      console.error('email_send provider rejected:', sendError)
      return reply(502, 'provider_rejected', 'Furnizorul de email a refuzat mesajul. Verifică adresele și încearcă din nou.')
    }

    await logAction({
      actorId: access.user.id,
      actionType: 'email_send',
      entityType: 'file',
      entityId: fileId,
      entityName: fileName,
      newValues: {
        file_id: fileId,
        project_id: projectId,
        project_title: projectTitle,
        document_request_name: requirementName,
        recipients: recipients.emails,
        copy_to_sender: !!cc,
        subject: subject.trim(),
        provider_id: sent?.id ?? null,
      },
      description: `${senderEmail ?? senderName} a trimis pe email fișierul "${fileName}" din proiectul "${projectTitle}" către ${recipients.emails.join(', ')}`,
      request,
    })

    return NextResponse.json({ status: 'sent', recipients: recipients.emails, copyToMe: !!cc })
  } catch (error) {
    console.error('POST /api/files/[fileId]/email error:', error)
    return reply(500, 'server_error', 'Nu am putut trimite emailul. Încearcă din nou.')
  }
}
