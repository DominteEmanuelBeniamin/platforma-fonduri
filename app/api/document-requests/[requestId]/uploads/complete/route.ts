import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { isClientVisibleDocument } from '@/lib/client-visibility'
import {
  isValidDocumentActionUuid,
  MAX_UPLOAD_FILE_SIZE,
  normalizeUploadFileIds,
} from '@/lib/document-action-idempotency'

const BUCKET = 'project-files'
const MAX_FILES = 50

type ExpectedFile = {
  file_id: string
  storage_path: string
  original_name: string
  declared_size: number
  mime_type: string | null
}

function isExpectedFile(value: unknown): value is ExpectedFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<ExpectedFile>
  return isValidDocumentActionUuid(file.file_id) &&
    typeof file.storage_path === 'string' && file.storage_path.length > 0 &&
    typeof file.original_name === 'string' && file.original_name.length > 0 &&
    typeof file.declared_size === 'number' && Number.isSafeInteger(file.declared_size) &&
    file.declared_size >= 0 && file.declared_size <= MAX_UPLOAD_FILE_SIZE &&
    (file.mime_type === null || typeof file.mime_type === 'string')
}

function storageObjectSize(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const metadata = (value as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== 'object') return null
  const rawSize = (metadata as { size?: unknown; contentLength?: unknown }).size ??
    (metadata as { contentLength?: unknown }).contentLength
  const size = typeof rawSize === 'number' ? rawSize : Number(rawSize)
  return Number.isSafeInteger(size) && size >= 0 ? size : null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { batchId, fileIds } = body as { batchId?: unknown; fileIds?: unknown }
    if (!isValidDocumentActionUuid(batchId)) {
      return NextResponse.json({ error: 'batchId must be a valid UUID' }, { status: 400 })
    }
    if (!Array.isArray(fileIds) || fileIds.length < 1 || fileIds.length > MAX_FILES) {
      return NextResponse.json({ error: `fileIds[] must be 1..${MAX_FILES}` }, { status: 400 })
    }
    if (fileIds.some(fileId => !isValidDocumentActionUuid(fileId))) {
      return NextResponse.json({ error: 'fileIds[] must contain valid UUIDs' }, { status: 400 })
    }
    const normalizedFileIds = normalizeUploadFileIds(fileIds)
    if (!normalizedFileIds) {
      return NextResponse.json({ error: 'fileIds[] must not contain duplicates' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()
    const { data: reqRow, error: reqErr } = await admin
      .from('document_requirements')
      .select('id, project_id, name, activity_id, assigned_to, visibility, is_outgoing, deleted_at, activity:activity_id(assigned_to, visibility, phase:phase_id(visibility))')
      .eq('id', requestId)
      .is('deleted_at', null)
      .single()

    if (reqErr || !reqRow) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }
    if (!reqRow.project_id) {
      return NextResponse.json({ error: 'Document request is not linked to a project' }, { status: 500 })
    }

    const access = await requireProjectAccess(request, reqRow.project_id)
    if (!access.ok) return guardToResponse(access)
    if (access.profile.role === 'client' && !isClientVisibleDocument(reqRow)) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }
    if (reqRow.is_outgoing) {
      return NextResponse.json({ error: 'Documentele trimise clientului nu acceptă răspunsuri încărcate.' }, { status: 400 })
    }

    const { data: batch, error: batchError } = await admin
      .from('document_upload_batches')
      .select('id, requirement_id, uploaded_by, expected_files, completed_file_ids, version_number')
      .eq('id', batchId)
      .maybeSingle()

    if (batchError) {
      console.error('Failed to load document upload batch:', batchError)
      return NextResponse.json({ error: 'Failed to load document upload batch' }, { status: 500 })
    }
    if (!batch || batch.requirement_id !== requestId || batch.uploaded_by !== access.user.id) {
      return NextResponse.json({ error: 'Document upload batch not found' }, { status: 404 })
    }

    if (!Array.isArray(batch.expected_files) ||
        batch.expected_files.length < 1 ||
        batch.expected_files.length > MAX_FILES ||
        !batch.expected_files.every(isExpectedFile)) {
      return NextResponse.json({ error: 'Document upload batch is invalid' }, { status: 500 })
    }
    const expectedFiles = batch.expected_files as ExpectedFile[]
    if (new Set(expectedFiles.map(file => file.file_id)).size !== expectedFiles.length ||
        new Set(expectedFiles.map(file => file.storage_path)).size !== expectedFiles.length) {
      return NextResponse.json({ error: 'Document upload batch is invalid' }, { status: 500 })
    }

    const expectedById = new Map(expectedFiles.map(file => [file.file_id, file]))
    const selectedFiles = (fileIds as string[]).map(fileId => expectedById.get(fileId))
    if (selectedFiles.some(file => !file)) {
      return NextResponse.json({ error: 'fileIds[] contains an unknown file' }, { status: 400 })
    }

    if (batch.version_number !== null) {
      const normalizedCompletedIds = normalizeUploadFileIds(batch.completed_file_ids)
      if (!normalizedCompletedIds) {
        return NextResponse.json({ error: 'Document upload batch is invalid' }, { status: 500 })
      }
      if (JSON.stringify(normalizedFileIds) !== JSON.stringify(normalizedCompletedIds)) {
        return NextResponse.json({ error: 'Upload batch already completed with a different file set' }, { status: 409 })
      }
      return NextResponse.json({ ok: true, created: false, versionNumber: batch.version_number })
    }

    const storageResults = await Promise.all((selectedFiles as ExpectedFile[]).map(async file => {
      try {
        const { data: storageInfo, error: storageError } = await admin.storage
          .from(BUCKET)
          .info(file.storage_path)
        return { file, actualSize: storageError ? null : storageObjectSize(storageInfo) }
      } catch {
        return { file, actualSize: null }
      }
    }))
    const invalidStorage = storageResults.find(({ file, actualSize }) =>
      actualSize === null || actualSize > MAX_UPLOAD_FILE_SIZE || actualSize !== file.declared_size
    )
    if (invalidStorage) {
      const { file, actualSize } = invalidStorage
      return NextResponse.json({
        error: actualSize === null
          ? `Uploaded object is missing for ${file.original_name}`
          : `Uploaded object size does not match ${file.original_name}`,
      }, { status: 400 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      null

    const { data: rpcData, error: rpcError } = await admin.rpc('complete_reserved_document_upload_batch', {
      p_upload_batch_id: batchId,
      p_actor_id: access.user.id,
      p_selected_file_ids: normalizedFileIds,
      p_ip_address: ipAddress,
    })

    if (rpcError) {
      console.error('complete_reserved_document_upload_batch error:', rpcError)
      const status = rpcError.code === 'P0001' ? 409 : 500
      return NextResponse.json({ error: rpcError.message }, { status })
    }

    const result = Array.isArray(rpcData) ? rpcData[0] as { created?: unknown; version_number?: unknown } | undefined : undefined
    if (!result || typeof result.created !== 'boolean' ||
        typeof result.version_number !== 'number' ||
        !Number.isInteger(result.version_number) || result.version_number < 1) {
      console.error('complete_reserved_document_upload_batch returned an invalid result:', rpcData)
      return NextResponse.json({ error: 'Invalid document upload completion response' }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      created: result.created,
      versionNumber: result.version_number,
    })
  } catch (error: unknown) {
    console.error('POST uploads/complete error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
