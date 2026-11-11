import { NextResponse } from 'next/server'
import { logAction } from '@/app/api/_utils/audit'
import { internalAttachmentNotFound, internalEntryNotFound, loadInternalEntry, requireInternalProjectAccess } from '@/app/api/_utils/internal-entries'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { isInternalEntryUuid } from '@/lib/internal-entry-security'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; entryId: string; attachmentId: string }> }) {
  try {
    const { id: projectId, entryId, attachmentId } = await params
    const access = await requireInternalProjectAccess(request, projectId, true)
    if (!access.ok) return access.response
    if (access.profile.role !== 'admin' && !(access.profile.role === 'consultant' && access.profile.consultant_level === 'senior')) {
      return NextResponse.json({ error: 'You cannot remove internal attachments' }, { status: 403 })
    }
    if (!isInternalEntryUuid(entryId) || !isInternalEntryUuid(attachmentId)) return internalAttachmentNotFound()
    const admin = createSupabaseServiceClient()
    const loaded = await loadInternalEntry(admin, projectId, entryId)
    if (loaded.error) throw loaded.error
    if (!loaded.entry) return internalEntryNotFound()

    const deletedAt = new Date().toISOString()
    const { data: attachment, error } = await admin.from('project_internal_attachments')
      .update({ deleted_at: deletedAt })
      .eq('id', attachmentId).eq('entry_id', entryId)
      .is('deleted_at', null).not('uploaded_at', 'is', null)
      .select('id, original_name').maybeSingle()
    if (error) throw error
    if (!attachment) return internalAttachmentNotFound()
    await logAction({
      actorId: access.user.id, actionType: 'delete', entityType: 'project_internal_attachment',
      entityId: attachment.id, entityName: attachment.original_name,
      newValues: { entry_id: entryId, deleted_at: deletedAt },
      description: 'A retras un fișier din dosarul intern al proiectului.', request,
    })
    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('DELETE internal attachment failed:', error)
    return NextResponse.json({ error: 'Failed to remove internal attachment' }, { status: 500 })
  }
}
