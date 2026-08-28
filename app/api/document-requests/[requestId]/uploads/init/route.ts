import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { isClientVisibleDocument } from '@/lib/client-visibility'

const BUCKET = 'project-files'
const MAX_FILES = 50
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

type UploadInitFile = {
  name: string
  size: number
  type?: string | null
  relativePath?: string | null
}

function safeSegment(value: string) {
  return value.replace(/[^\w.\- ()]/g, '_')
}

function safeRelativePath(path?: string | null) {
  if (!path) return null
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized
    .split('/')
    .filter(Boolean)
    .filter(segment => segment !== '.' && segment !== '..')
  return parts.map(safeSegment).join('/') || null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || !Array.isArray(body.files)) {
      return NextResponse.json({ error: 'files[] is required' }, { status: 400 })
    }
    if (body.files.length < 1 || body.files.length > MAX_FILES) {
      return NextResponse.json({ error: `files[] must be 1..${MAX_FILES}` }, { status: 400 })
    }

    const files = body.files as UploadInitFile[]
    for (const file of files) {
      if (typeof file?.name !== 'string' || !file.name.trim()) {
        return NextResponse.json({ error: 'Each file must have a valid name' }, { status: 400 })
      }
      if (
        typeof file.size !== 'number' ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > MAX_FILE_SIZE
      ) {
        return NextResponse.json({ error: `Invalid file size for ${file?.name ?? 'file'}` }, { status: 400 })
      }
      if (file.type !== undefined && file.type !== null && typeof file.type !== 'string') {
        return NextResponse.json({ error: 'type must be a string when provided' }, { status: 400 })
      }
      if (file.relativePath !== undefined && file.relativePath !== null && typeof file.relativePath !== 'string') {
        return NextResponse.json({ error: 'relativePath must be a string when provided' }, { status: 400 })
      }
    }

    const { requestId } = await params
    const admin = createSupabaseServiceClient()
    const { data: reqRow, error: reqErr } = await admin
      .from('document_requirements')
      .select('id, project_id, activity_id, visibility, is_outgoing, deleted_at, activity:activity_id(visibility, phase:phase_id(visibility))')
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
    if (reqRow.is_outgoing) {
      return NextResponse.json({ error: 'Documentele trimise clientului nu acceptă răspunsuri încărcate.' }, { status: 400 })
    }

    const batchId = crypto.randomUUID()
    const expectedFiles = files.map((file, index) => {
      const fileId = crypto.randomUUID()
      const relativePath = safeRelativePath(file.relativePath)
      const fileName = relativePath || safeSegment(file.name)
      const storagePath = [
        'projects',
        reqRow.project_id,
        'document-requests',
        requestId,
        'batches',
        batchId,
        fileId,
        fileName,
      ].join('/')

      return {
        file_id: fileId,
        client_file_id: index,
        storage_path: storagePath,
        original_name: file.name,
        declared_size: file.size,
        mime_type: typeof file.type === 'string' && file.type.trim() ? file.type.trim() : null,
        relative_path: relativePath,
      }
    })

    const { error: batchError } = await admin
      .from('document_upload_batches')
      .insert({
        id: batchId,
        requirement_id: requestId,
        uploaded_by: access.user.id,
        expected_files: expectedFiles,
      })

    if (batchError) {
      console.error('Failed to persist document upload batch:', batchError)
      return NextResponse.json({ error: 'Failed to initialize document upload' }, { status: 500 })
    }

    const uploads = await Promise.all(expectedFiles.map(async expected => {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(expected.storage_path)
      if (error || !data) throw new Error(`Failed to sign upload for ${expected.original_name}`)

      return {
        fileId: expected.file_id,
        clientFileId: expected.client_file_id,
        storagePath: expected.storage_path,
        relativePath: expected.relative_path,
        signedUploadUrl: data.signedUrl,
        token: data.token,
      }
    }))

    return NextResponse.json({ batchId, uploads })
  } catch (error: unknown) {
    console.error('POST uploads/init error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
