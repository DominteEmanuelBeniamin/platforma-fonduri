import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { logAction } from '@/app/api/_utils/audit'
import { isPreviewableFileName, clampExpiresIn } from '@/lib/file-preview'
import { isClientVisibleDocument } from '@/lib/client-visibility'

const BUCKET = 'project-files'

type AttachmentRow = {
  id: string
  storage_path: string
  original_name: string | null
  missing_at: string | null
  order_index: number | null
}

async function signedObjectExists(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function markAttachmentMissing(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  reqRow: {
    attachment_path: string
    attachment_missing_at: string | null
  },
  attachmentId?: string | null,
) {
  const checkedAt = new Date().toISOString()
  const missingAt = reqRow.attachment_missing_at ?? checkedAt

  await Promise.all([
    admin
      .from('document_requirements')
      .update({
        attachment_missing_at: missingAt,
        attachment_missing_checked_at: checkedAt,
      })
      .eq('attachment_path', reqRow.attachment_path)
      .is('deleted_at', null),
    admin
      .from('template_document_requirements')
      .update({
        attachment_missing_at: missingAt,
        attachment_missing_checked_at: checkedAt,
      })
      .eq('attachment_path', reqRow.attachment_path),
    attachmentId
      ? admin.from('document_requirement_attachments').update({ missing_at: missingAt, missing_checked_at: checkedAt }).eq('id', attachmentId)
      : Promise.resolve({ error: null }),
  ])
}

async function clearAttachmentMissing(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  reqRow: {
    attachment_path: string
  },
  attachmentId?: string | null,
) {
  const checkedAt = new Date().toISOString()

  await Promise.all([
    admin
      .from('document_requirements')
      .update({
        attachment_missing_at: null,
        attachment_missing_checked_at: checkedAt,
      })
      .eq('attachment_path', reqRow.attachment_path)
      .is('deleted_at', null),
    admin
      .from('template_document_requirements')
      .update({
        attachment_missing_at: null,
        attachment_missing_checked_at: checkedAt,
      })
      .eq('attachment_path', reqRow.attachment_path),
    attachmentId
      ? admin.from('document_requirement_attachments').update({ missing_at: null, missing_checked_at: checkedAt }).eq('id', attachmentId)
      : Promise.resolve({ error: null }),
  ])
}

function missingAttachmentResponse() {
  return NextResponse.json(
    { error: 'Modelul atașat este momentan indisponibil. Echipa a fost notificată.' },
    { status: 404 }
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const body = await request.json().catch(() => ({}))
    const expiresIn = clampExpiresIn(body?.expiresIn)
    const inlineRequested = body?.disposition === 'inline'
    const attachmentId = typeof body?.attachment_id === 'string' ? body.attachment_id : null

    const admin = createSupabaseServiceClient()

    const { data: reqRow, error: reqErr } = await admin
      .from('document_requirements')
      .select('project_id, name, activity_id, visibility, is_outgoing, attachment_path, attachment_original_name, attachment_missing_at, deleted_at, activity:activity_id(visibility, phase:phase_id(visibility)), document_requirement_attachments(id, storage_path, original_name, missing_at, missing_checked_at, order_index)')
      .eq('id', requestId)
      .is('deleted_at', null)
      .single()

    if (reqErr || !reqRow) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    const access = await requireProjectAccess(request, reqRow.project_id)
    if (!access.ok) return guardToResponse(access)
    if (access.profile.role === 'client' && !isClientVisibleDocument(reqRow)) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    const { data: projectRow } = await admin
      .from('projects')
      .select('title')
      .eq('id', reqRow.project_id)
      .maybeSingle()
    const projectTitle = projectRow?.title ?? reqRow.project_id
    const requestName = reqRow.name || requestId

    const attachment = ((reqRow as { document_requirement_attachments?: AttachmentRow[] }).document_requirement_attachments ?? [])
      .filter(item => !attachmentId || item.id === attachmentId)
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))[0]
    const attachmentPath = attachment?.storage_path || reqRow.attachment_path
    const attachmentName = attachment?.original_name || reqRow.attachment_original_name
    const attachmentMissingAt = attachment?.missing_at || reqRow.attachment_missing_at

    if (!attachmentPath) {
      return NextResponse.json({ error: 'No attachment on this request' }, { status: 404 })
    }

    // atașamentele nu au mime type stocat, decidem după extensia numelui
    const inline = inlineRequested && isPreviewableFileName(attachmentName || attachmentPath)

    const { data, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(attachmentPath, expiresIn, {
        download: inline ? false : (attachmentName || true),
      })

    if (signErr || !data?.signedUrl) {
      console.error('signed url error:', signErr)
      await markAttachmentMissing(admin, {
        attachment_path: attachmentPath,
        attachment_missing_at: attachmentMissingAt,
      }, attachment?.id)
      return missingAttachmentResponse()
    }

    const exists = await signedObjectExists(data.signedUrl)
    if (!exists) {
      await markAttachmentMissing(admin, {
        attachment_path: attachmentPath,
        attachment_missing_at: attachmentMissingAt,
      }, attachment?.id)
      return missingAttachmentResponse()
    }

    if (attachmentMissingAt) {
      await clearAttachmentMissing(admin, {
        attachment_path: attachmentPath,
      }, attachment?.id)
    }

    await logAction({
      actorId: access.user.id,
      actionType: 'download',
      entityType: 'file_access',
      entityId: requestId,
      entityName: attachmentName || attachmentPath,
      newValues: {
        document_request_id: requestId,
        document_request_name: requestName,
        project_id: reqRow.project_id,
        project_title: projectTitle,
        attachment_path: attachmentPath,
        attachment_original_name: attachmentName ?? null,
        expires_in: expiresIn,
        is_outgoing: Boolean(reqRow.is_outgoing),
        disposition: inline ? 'inline' : 'attachment',
      },
      description: reqRow.is_outgoing
        ? `${inline ? 'Vizualizare' : 'Descarcare'} document trimis clientului "${requestName}" din proiectul "${projectTitle}"`
        : `${inline ? 'Vizualizare' : 'Descarcare'} model atasat cererii "${requestName}" din proiectul "${projectTitle}"`,
      request,
    })

    return NextResponse.json({ url: data.signedUrl })
  } catch (e: unknown) {
    console.error('POST attachment/signed-download error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
