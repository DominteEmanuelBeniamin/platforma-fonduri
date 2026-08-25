import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { isClientVisibleDocument } from '@/lib/client-visibility'
import {
  hasDuplicateUploadPaths,
  isValidDocumentActionUuid,
  isValidUploadFileSize,
  isValidUploadStoragePath,
  MAX_UPLOAD_FILE_SIZE,
} from '@/lib/document-action-idempotency'

const MAX_FILES = 50
const MAX_ORIGINAL_NAME_LENGTH = 200

type UploadedInput = {
  storagePath?: unknown
  originalName?: unknown
  mimeType?: unknown
  fileSize?: unknown
}

type NormalizedUpload = {
  storagePath: string
  originalName: string
  mimeType: string | null
  fileSize: number | null
}

function normalizeOriginalName(name: string) {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_ORIGINAL_NAME_LENGTH)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { batchId, versionNumber, uploaded } = body as {
      batchId?: unknown
      versionNumber?: unknown
      uploaded?: unknown
    }

    if (!isValidDocumentActionUuid(batchId)) {
      return NextResponse.json({ error: 'batchId must be a valid UUID' }, { status: 400 })
    }
    if (typeof versionNumber !== 'number' || !Number.isInteger(versionNumber) || versionNumber < 1) {
      return NextResponse.json({ error: 'versionNumber must be an integer >= 1' }, { status: 400 })
    }
    if (!Array.isArray(uploaded) || uploaded.length < 1 || uploaded.length > MAX_FILES) {
      return NextResponse.json({ error: `uploaded[] must be 1..${MAX_FILES}` }, { status: 400 })
    }

    const normalizedUploads: NormalizedUpload[] = []
    for (const item of uploaded) {
      const u: UploadedInput | null = item && typeof item === 'object' ? item : null
      if (!u?.storagePath || typeof u.storagePath !== 'string') {
        return NextResponse.json({ error: 'Each uploaded item must include storagePath' }, { status: 400 })
      }

      const originalName = typeof u.originalName === 'string' ? normalizeOriginalName(u.originalName) : ''
      if (!originalName) {
        return NextResponse.json({ error: 'Each uploaded item must include a valid originalName' }, { status: 400 })
      }

      if (u.mimeType !== undefined && u.mimeType !== null && typeof u.mimeType !== 'string') {
        return NextResponse.json({ error: 'mimeType must be a string when provided' }, { status: 400 })
      }

      if (!isValidUploadFileSize(u.fileSize)) {
        return NextResponse.json({ error: `fileSize must be between 0 and ${MAX_UPLOAD_FILE_SIZE} bytes when provided` }, { status: 400 })
      }

      normalizedUploads.push({
        storagePath: u.storagePath,
        originalName,
        mimeType: typeof u.mimeType === 'string' && u.mimeType.trim() ? u.mimeType.trim() : null,
        fileSize: typeof u.fileSize === 'number' ? Math.trunc(u.fileSize) : null,
      })
    }

    if (hasDuplicateUploadPaths(normalizedUploads.map(upload => upload.storagePath))) {
      return NextResponse.json({ error: 'uploaded[] must not contain duplicate storagePath values' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    const { data: reqRow, error: reqErr } = await admin
      .from('document_requirements')
      .select('id, project_id, name, activity_id, assigned_to, visibility, is_outgoing, deleted_at, activity:activity_id(assigned_to, visibility, phase:phase_id(visibility))')
      .eq('id', requestId)
      .is('deleted_at', null)
      .single()

    if (reqErr) {
      console.error('Failed to load document requirement:', reqErr)
      return NextResponse.json({ error: 'Document request not found: ' + reqErr.message }, { status: 404 })
    }

    if (!reqRow) {
      console.error('Document requirement not found for requestId:', requestId)
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    if (!reqRow.project_id) {
      console.error('Document requirement has no project_id:', reqRow)
      return NextResponse.json({ error: 'Document request is not linked to a project' }, { status: 500 })
    }

    if (normalizedUploads.some(upload => !isValidUploadStoragePath(upload.storagePath, reqRow.project_id, requestId, versionNumber))) {
      return NextResponse.json({ error: 'storagePath is outside the document request upload directory' }, { status: 400 })
    }

    const access = await requireProjectAccess(request, reqRow.project_id)
    if (!access.ok) {
      console.error('Project access denied:', access.error, 'project_id:', reqRow.project_id)
      return guardToResponse(access)
    }

    if (access.profile.role === 'client' && !isClientVisibleDocument(reqRow)) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    if (reqRow.is_outgoing) {
      return NextResponse.json({ error: 'Documentele trimise clientului nu acceptă răspunsuri încărcate.' }, { status: 400 })
    }

    console.log('Project access granted for user:', access.user.id, 'project:', reqRow.project_id)

    const rows = normalizedUploads.map((u) => ({
      requirement_id: requestId,
      upload_batch_id: batchId,
      storage_path: u.storagePath,
      original_name: u.originalName,
      mime_type: u.mimeType,
      file_size: u.fileSize,
      version_number: versionNumber,
      uploaded_by: access.user.id,
    }))

    const ipAddress = request.headers.get('x-forwarded-for') ||
                      request.headers.get('x-real-ip') ||
                      null

    const { error: batchError } = await admin.rpc('complete_document_upload_batch', {
      p_requirement_id: requestId,
      p_upload_batch_id: batchId,
      p_version_number: versionNumber,
      p_uploaded_by: access.user.id,
      p_rows: rows,
      p_ip_address: ipAddress,
    })

    if (batchError) {
      console.error('complete_document_upload_batch error:', batchError)
      const status = batchError.code === 'P0001' ? 409 : 500
      return NextResponse.json({ error: batchError.message }, { status })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const error = e as Error
    console.error('POST uploads/complete error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}
