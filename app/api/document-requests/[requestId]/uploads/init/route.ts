import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const BUCKET = 'project-files'
const MAX_FILES = 50
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

function safeSegment(s: string) {
  return s.replace(/[^\w.\- ()]/g, '_')
}

function safeRelativePath(p?: string | null) {
  if (!p) return null
  const normalized = p.replace(/\\/g, '/')
  const parts = normalized
    .split('/')
    .filter(Boolean)
    .filter(seg => seg !== '.' && seg !== '..')
  return parts.map(safeSegment).join('/')
}

export async function POST(request: Request, 
    { params }: { params: Promise<{requestId: string }> }) {
  try {
    const body = await request.json().catch(() => null)
    if (!body?.files || !Array.isArray(body.files)) {
      return NextResponse.json({ error: 'files[] is required' }, { status: 400 })
    }
    if (body.files.length < 1 || body.files.length > MAX_FILES) {
      return NextResponse.json({ error: `files[] must be 1..${MAX_FILES}` }, { status: 400 })
    }
    const {requestId} = await params
    // Validate file meta quickly
    for (const f of body.files) {
      if (!f?.name || typeof f.name !== 'string') {
        return NextResponse.json({ error: 'Each file must have a valid name' }, { status: 400 })
      }
      if (typeof f.size !== 'number' || f.size < 0 || f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `Invalid file size for ${f?.name ?? 'file'}` }, { status: 400 })
      }
    }

    const admin = createSupabaseServiceClient()

    // Load requirement -> project_id
    const { data: reqRow, error: reqErr } = await admin
      .from('document_requirements')
      .select('id, project_id')
      .eq('id', requestId)
      .single()

    if (reqErr || !reqRow) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    const access = await requireProjectAccess(request, reqRow.project_id)
    if (!access.ok) return guardToResponse(access)

    // Compute next version_number
    const { data: lastFile } = await admin
      .from('files')
      .select('version_number')
      .eq('requirement_id', requestId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const versionNumber = (lastFile?.version_number ?? 0) + 1
    const batchId = crypto.randomUUID()

    // Signed upload URLs
    const uploads = await Promise.all(
      body.files.map(async (f: any, idx: number) => {
        const rel = safeRelativePath(f.relativePath)
        const finalName = rel ?? `${crypto.randomUUID()}_${safeSegment(f.name)}`

        const storagePath =
          `projects/${reqRow.project_id}/document-requests/${requestId}/v${versionNumber}/${finalName}`

        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath)
        if (error || !data) throw new Error(`Failed to sign upload for ${f.name}`)

        return {
          clientFileId: idx,
          storagePath,
          signedUploadUrl: data.signedUrl,
          token: data.token,
          relativePath: rel, // optional; FE can ignore
        }
      })
    )

    return NextResponse.json({ batchId, versionNumber, uploads })
  } catch (e: any) {
    console.error('POST uploads/init error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
