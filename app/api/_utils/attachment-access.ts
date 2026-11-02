import { NextResponse } from 'next/server'
import { requireProjectAccess, guardToResponse } from './auth'
import { createSupabaseServiceClient } from './supabase'
import { isClientVisibleDocument } from '@/lib/client-visibility'

// Cine poate citi un atașament al unei cereri (modelul de completat sau
// documentul trimis clientului): echipa proiectului, iar clientul doar pe
// cererile publicate pentru el. O singură regulă pentru descărcare și email.

type AttachmentRow = {
  id: string
  storage_path: string
  original_name: string | null
  missing_at: string | null
  order_index: number | null
}

export type ReadableAttachment = {
  access: Extract<Awaited<ReturnType<typeof requireProjectAccess>>, { ok: true }>
  requestId: string
  attachmentId: string | null
  path: string
  fileName: string
  missingAt: string | null
  projectId: string
  projectTitle: string
  requestName: string
  isOutgoing: boolean
}

export async function readableAttachment(
  request: Request,
  requestId: string,
  attachmentId: string | null,
): Promise<{ ok: true; value: ReadableAttachment } | { ok: false; response: Response }> {
  const admin = createSupabaseServiceClient()
  const { data: reqRow, error: reqErr } = await admin
    .from('document_requirements')
    .select('project_id, name, activity_id, visibility, is_outgoing, attachment_path, attachment_original_name, attachment_missing_at, deleted_at, activity:activity_id(visibility, phase:phase_id(visibility)), document_requirement_attachments(id, storage_path, original_name, missing_at, missing_checked_at, order_index)')
    .eq('id', requestId)
    .is('deleted_at', null)
    .single()

  if (reqErr || !reqRow) {
    return { ok: false, response: NextResponse.json({ error: 'Document request not found' }, { status: 404 }) }
  }

  const access = await requireProjectAccess(request, reqRow.project_id)
  if (!access.ok) return { ok: false, response: guardToResponse(access) }
  if (access.profile.role === 'client' && !isClientVisibleDocument(reqRow)) {
    return { ok: false, response: NextResponse.json({ error: 'Document request not found' }, { status: 404 }) }
  }

  const attachment = ((reqRow as { document_requirement_attachments?: AttachmentRow[] }).document_requirement_attachments ?? [])
    .filter(item => !attachmentId || item.id === attachmentId)
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))[0]
  const path = attachment?.storage_path || reqRow.attachment_path
  if (!path) {
    return { ok: false, response: NextResponse.json({ error: 'No attachment on this request' }, { status: 404 }) }
  }

  const { data: projectRow } = await admin
    .from('projects')
    .select('title')
    .eq('id', reqRow.project_id)
    .maybeSingle()

  return {
    ok: true,
    value: {
      access,
      requestId,
      attachmentId: attachment?.id ?? null,
      path,
      fileName: attachment?.original_name || reqRow.attachment_original_name || path.split('/').filter(Boolean).pop() || 'document',
      missingAt: attachment?.missing_at || reqRow.attachment_missing_at,
      projectId: reqRow.project_id,
      projectTitle: projectRow?.title ?? reqRow.project_id,
      requestName: reqRow.name || requestId,
      isOutgoing: Boolean(reqRow.is_outgoing),
    },
  }
}
