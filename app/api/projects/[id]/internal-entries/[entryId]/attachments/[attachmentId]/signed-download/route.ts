import { NextResponse } from 'next/server'
import { logAction } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { INTERNAL_ATTACHMENT_BUCKET, INTERNAL_DOWNLOAD_TTL_SECONDS, internalAttachmentNotFound, internalEntryNotFound, loadInternalEntry, requireInternalProjectAccess } from '@/app/api/_utils/internal-entries'
import { isInternalEntryUuid } from '@/lib/internal-entry-security'
import { isPreviewableFile } from '@/lib/file-preview'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string; attachmentId: string }> },
) {
  try {
    const { id: projectId, entryId, attachmentId } = await params
    const access = await requireInternalProjectAccess(request, projectId)
    if (!access.ok) return access.response
    if (!isInternalEntryUuid(entryId) || !isInternalEntryUuid(attachmentId)) return internalAttachmentNotFound()

    const admin = createSupabaseServiceClient()
    const loadedEntry = await loadInternalEntry(admin, projectId, entryId)
    if (loadedEntry.error) throw loadedEntry.error
    if (!loadedEntry.entry) return internalEntryNotFound()

    const { data: attachment, error } = await admin.from('project_internal_attachments')
      .select('id, entry_id, storage_path, original_name, mime_type')
      .eq('id', attachmentId)
      .eq('entry_id', entryId)
      .is('deleted_at', null)
      .not('uploaded_at', 'is', null)
      .maybeSingle()
    if (error) throw error
    if (!attachment) return internalAttachmentNotFound()

    const body = await request.json().catch(() => ({}))
    const inline = body.disposition === 'inline' && isPreviewableFile({ mimeType: attachment.mime_type, fileName: attachment.original_name })
    if (body.disposition === 'inline' && !inline) return NextResponse.json({ error: 'Formatul nu poate fi previzualizat' }, { status: 400 })

    const { data, error: signError } = await admin.storage.from(INTERNAL_ATTACHMENT_BUCKET)
      .createSignedUrl(attachment.storage_path, INTERNAL_DOWNLOAD_TTL_SECONDS, { download: inline ? false : attachment.original_name })
    if (signError || !data) throw signError ?? new Error('Storage did not return a signed download URL')
    const expiresAt = new Date(Date.now() + INTERNAL_DOWNLOAD_TTL_SECONDS * 1000).toISOString()

    await logAction({
      actorId: access.user.id,
      actionType: 'download',
      entityType: 'project_internal_attachment',
      entityId: attachment.id,
      entityName: attachment.original_name,
      newValues: { entry_id: entryId, mime_type: attachment.mime_type },
      description: 'A descărcat un fișier din dosarul intern al proiectului.',
      request,
    })

    return NextResponse.json({ url: data.signedUrl, expiresAt }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('POST internal attachment signed-download failed:', error)
    return NextResponse.json({ error: 'Failed to create attachment download link' }, { status: 500 })
  }
}
