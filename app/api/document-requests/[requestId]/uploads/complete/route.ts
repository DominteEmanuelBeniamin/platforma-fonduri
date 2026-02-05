import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const MAX_FILES = 50

export async function POST(request: Request,
  { params }: { params: Promise<{ requestId: string }> }) {
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

    if (typeof batchId !== 'string' || !batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 })
    }
    if (typeof versionNumber !== 'number' || !Number.isInteger(versionNumber) || versionNumber < 1) {
      return NextResponse.json({ error: 'versionNumber must be an integer >= 1' }, { status: 400 })
    }
    if (!Array.isArray(uploaded) || uploaded.length < 1 || uploaded.length > MAX_FILES) {
      return NextResponse.json({ error: `uploaded[] must be 1..${MAX_FILES}` }, { status: 400 })
    }

    for (const u of uploaded) {
      if (!u?.storagePath || typeof u.storagePath !== 'string') {
        return NextResponse.json({ error: 'Each uploaded item must include storagePath' }, { status: 400 })
      }
      if (!u?.originalName || typeof u.originalName !== 'string') {
        return NextResponse.json({ error: 'Each uploaded item must include originalName' }, { status: 400 })
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

    // Insert files (schema-aligned)
    const rows = uploaded.map((u: any) => ({
      requirement_id: requestId,
      storage_path: u.storagePath,
      version_number: versionNumber,
      uploaded_by: access.user.id,
      // comments: null (default)
      // created_at: default
      // NOTE: nu avem coloane pentru original_name/mime/size momentan
    }))

    const { error: insErr } = await admin.from('files').insert(rows)
    if (insErr) {
      console.error('files insert error:', insErr)
      return NextResponse.json({ error: insErr.message }, { status: 400 })
    }

    //Update requirement status -> review
    const { error: updErr } = await admin
      .from('document_requirements')
      .update({ status: 'review' })
      .eq('id', requestId)

    if (updErr) {
      console.error('requirements update error:', updErr)
      return NextResponse.json({ error: updErr.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('POST uploads/complete error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
