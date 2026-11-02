import { readableFile } from '@/app/api/_utils/file-access'
import { deliverDocumentEmail, documentEmailReply, parseDocumentEmailForm } from '@/app/api/_utils/document-email'

// „Trimite pe email” pentru un fișier încărcat într-o cerere. Aceleași drepturi
// ca la descărcare; trimiterea propriu-zisă e în `document-email.ts`.

export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params
    const parsed = parseDocumentEmailForm(await request.json().catch(() => null))
    if (!parsed.ok) return parsed.response

    const readable = await readableFile(request, fileId)
    if (!readable.ok) return readable.response
    const { access, file, fileName, projectId, projectTitle, requirementName } = readable.value

    return await deliverDocumentEmail(request, parsed.form, {
      actorId: access.user.id,
      actorEmail: access.profile.email ?? null,
      storagePath: file.storage_path,
      fileName,
      mimeType: file.mime_type,
      size: file.file_size,
      projectId,
      projectTitle,
      documentName: requirementName,
      entityType: 'file',
      entityId: fileId,
      auditValues: { file_id: fileId },
    })
  } catch (error) {
    console.error('POST /api/files/[fileId]/email error:', error)
    return documentEmailReply(500, 'server_error', 'Nu am putut trimite emailul. Încearcă din nou.')
  }
}
