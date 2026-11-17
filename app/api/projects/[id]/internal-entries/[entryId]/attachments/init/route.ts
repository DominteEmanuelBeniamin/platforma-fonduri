import { NextResponse } from 'next/server'
import { canEditInternalEntry, isInternalEntryUuid, parseInternalAttachmentInput } from '@/lib/internal-entry-security'
import { internalEntryNotFound, INTERNAL_ATTACHMENT_BUCKET, loadInternalEntry, requireInternalProjectAccess } from '@/app/api/_utils/internal-entries'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const { id: projectId, entryId } = await params
    const access = await requireInternalProjectAccess(request, projectId, true)
    if (!access.ok) return access.response
    if (!isInternalEntryUuid(entryId)) return internalEntryNotFound()

    const parsed = parseInternalAttachmentInput(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'VALIDATION_ERROR' }, { status: 400 })

    const admin = createSupabaseServiceClient()
    const loaded = await loadInternalEntry(admin, projectId, entryId)
    if (loaded.error) throw loaded.error
    if (!loaded.entry) return internalEntryNotFound()
    if (!canEditInternalEntry(access.profile, loaded.entry)) {
      return NextResponse.json({ error: 'You cannot add attachments to this internal entry' }, { status: 403 })
    }

    const attachmentId = crypto.randomUUID()
    const storagePath = `${crypto.randomUUID()}/${crypto.randomUUID()}`
    const { error: insertError } = await admin.from('project_internal_attachments').insert({
      id: attachmentId,
      entry_id: entryId,
      storage_path: storagePath,
      original_name: parsed.value.originalName,
      mime_type: parsed.value.mimeType,
      file_size: parsed.value.fileSize,
      uploaded_by: access.user.id,
    })
    if (insertError) throw insertError

    const { data, error } = await admin.storage.from(INTERNAL_ATTACHMENT_BUCKET).createSignedUploadUrl(storagePath)
    if (error || !data) {
      await admin.from('project_internal_attachments').delete().eq('id', attachmentId)
      throw error ?? new Error('Storage did not return a signed upload URL')
    }

    return NextResponse.json({ attachmentId, uploadUrl: data.signedUrl, token: data.token }, { status: 201 })
  } catch (error) {
    console.error('POST internal attachment init failed:', error)
    return NextResponse.json({ error: 'Failed to initialize attachment upload' }, { status: 500 })
  }
}
