import { readableAttachment } from '@/app/api/_utils/attachment-access'
import { deliverDocumentEmail, documentEmailReply, parseDocumentEmailForm } from '@/app/api/_utils/document-email'

// „Trimite pe email” pentru un atașament al cererii: modelul de completat sau
// documentul trimis clientului. Aceleași drepturi ca la descărcarea lui.

export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params
    const body: unknown = await request.json().catch(() => null)
    const parsed = parseDocumentEmailForm(body)
    if (!parsed.ok) return parsed.response
    const rawAttachmentId = (body as Record<string, unknown>).attachment_id
    const attachmentId = typeof rawAttachmentId === 'string' ? rawAttachmentId : null

    const readable = await readableAttachment(request, requestId, attachmentId)
    if (!readable.ok) return readable.response
    const attachment = readable.value

    return await deliverDocumentEmail(request, parsed.form, {
      actorId: attachment.access.user.id,
      actorEmail: attachment.access.profile.email ?? null,
      storagePath: attachment.path,
      fileName: attachment.fileName,
      // Atașamentele nu au tipul salvat; Resend îl deduce din numele fișierului.
      mimeType: null,
      size: null,
      projectId: attachment.projectId,
      projectTitle: attachment.projectTitle,
      documentName: attachment.requestName,
      entityType: 'document_request',
      entityId: requestId,
      auditValues: { document_request_id: requestId, attachment_id: attachment.attachmentId, is_outgoing: attachment.isOutgoing },
    })
  } catch (error) {
    console.error('POST attachment/email error:', error)
    return documentEmailReply(500, 'server_error', 'Nu am putut trimite emailul. Încearcă din nou.')
  }
}
