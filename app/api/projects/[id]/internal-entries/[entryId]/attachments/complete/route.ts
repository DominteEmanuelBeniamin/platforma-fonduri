import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { INTERNAL_ATTACHMENT_BUCKET, internalAttachmentNotFound, internalEntryNotFound, loadInternalEntry, requireInternalProjectAccess } from '@/app/api/_utils/internal-entries'
import type { Database } from '@/lib/database.types'
import { isInternalEntryUuid, canEditInternalEntry, INTERNAL_ATTACHMENT_MAX_BYTES } from '@/lib/internal-entry-security'
import { logAction } from '@/app/api/_utils/audit'

type AttachmentRow = Database['public']['Tables']['project_internal_attachments']['Row']

function actualObjectSize(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const rawSize = (value as { size?: unknown }).size
  const size = typeof rawSize === 'number' ? rawSize : Number(rawSize)
  return Number.isSafeInteger(size) && size >= 0 ? size : null
}

function actualObjectMimeType(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const object = value as { metadata?: unknown; contentType?: unknown }
  const metadata = object.metadata
  const values = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
  const mimeType = values.mimetype ?? values.mimeType ?? values.contentType ??
    object.contentType
  return typeof mimeType === 'string' ? mimeType.split(';', 1)[0].trim().toLowerCase() : null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const { id: projectId, entryId } = await params
    const access = await requireInternalProjectAccess(request, projectId, true)
    if (!access.ok) return access.response
    if (!isInternalEntryUuid(entryId)) return internalEntryNotFound()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => key !== 'attachmentId') || !isInternalEntryUuid(body.attachmentId)) {
      return NextResponse.json({ error: 'attachmentId must be a valid UUID', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()
    const loaded = await loadInternalEntry(admin, projectId, entryId)
    if (loaded.error) throw loaded.error
    if (!loaded.entry) return internalEntryNotFound()
    if (!canEditInternalEntry(access.profile, loaded.entry)) {
      return NextResponse.json({ error: 'You cannot add attachments to this internal entry' }, { status: 403 })
    }

    const { data: attachment, error } = await admin.from('project_internal_attachments')
      .select('*')
      .eq('id', body.attachmentId)
      .eq('entry_id', entryId)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw error
    if (!attachment || attachment.uploaded_by !== access.user.id) return internalAttachmentNotFound()
    if (attachment.uploaded_at) return NextResponse.json({ attachment: attachmentResponse(attachment) })

    const { data: info, error: infoError } = await admin.storage
      .from(INTERNAL_ATTACHMENT_BUCKET)
      .info(attachment.storage_path)
    const size = infoError ? null : actualObjectSize(info)
    const mimeType = infoError ? null : actualObjectMimeType(info)
    const expectedMimeType = attachment.mime_type.split(';', 1)[0].trim().toLowerCase()
    if (size === null) {
      return NextResponse.json({ error: 'Uploaded object is missing', code: 'UPLOAD_INCOMPLETE' }, { status: 400 })
    }
    if (size > INTERNAL_ATTACHMENT_MAX_BYTES || size !== Number(attachment.file_size) || !mimeType || mimeType !== expectedMimeType) {
      await admin.storage.from(INTERNAL_ATTACHMENT_BUCKET).remove([attachment.storage_path])
      await admin.from('project_internal_attachments').update({ deleted_at: new Date().toISOString() }).eq('id', attachment.id)
      return NextResponse.json({ error: 'Uploaded object does not match its reservation', code: 'UPLOAD_INVALID' }, { status: 400 })
    }

    const uploadedAt = new Date().toISOString()
    const { data: completed, error: completeError } = await admin.from('project_internal_attachments')
      .update({ uploaded_at: uploadedAt })
      .eq('id', attachment.id)
      .is('uploaded_at', null)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()
    if (completeError) throw completeError
    if (!completed) {
      const { data: retry, error: retryError } = await admin.from('project_internal_attachments')
        .select('*').eq('id', attachment.id).eq('entry_id', entryId).is('deleted_at', null).maybeSingle()
      if (retryError) throw retryError
      if (!retry?.uploaded_at) return internalAttachmentNotFound()
      return NextResponse.json({ attachment: attachmentResponse(retry) })
    }

    await logAction({
      actorId: access.user.id,
      actionType: 'add',
      entityType: 'project_internal_attachment',
      entityId: attachment.id,
      entityName: attachment.original_name,
      newValues: { entry_id: entryId, file_size: attachment.file_size, mime_type: attachment.mime_type },
      description: 'A adăugat un fișier în dosarul intern al proiectului.',
      request,
    })

    return NextResponse.json({ attachment: attachmentResponse(completed) })
  } catch (error) {
    console.error('POST internal attachment complete failed:', error)
    return NextResponse.json({ error: 'Failed to complete attachment upload' }, { status: 500 })
  }
}

function attachmentResponse(attachment: AttachmentRow) {
  return {
    id: attachment.id,
    original_name: attachment.original_name,
    mime_type: attachment.mime_type,
    file_size: attachment.file_size,
    created_at: attachment.created_at,
    uploaded_by: attachment.uploaded_by,
  }
}
