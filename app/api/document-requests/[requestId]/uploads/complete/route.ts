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
    
    const access = await requireProjectAccess(request, reqRow.project_id)
    if (!access.ok) {
      console.error('Project access denied:', access.error, 'project_id:', reqRow.project_id)
      return guardToResponse(access)
    }

    console.log('Project access granted for user:', access.user.id, 'project:', reqRow.project_id)

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

    // Audit log pentru upload documente
    const ipAddress = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      null

    const fileNames = (uploaded as any[]).map(u => u.originalName).join(', ')

    await admin
      .from('audit_logs')
      .insert({
        user_id: access.user.id,
        action_type: 'create',
        entity_type: 'file',
        entity_id: requestId,
        entity_name: `${uploaded.length} fișier(e)`,
        new_values: {
          requirement_id: requestId,
          file_count: uploaded.length,
          version: versionNumber,
          files: fileNames
        },
        description: `${access.profile.email || 'User'} a încărcat ${uploaded.length} fișier(e) pentru cererea ${requestId}`,
        ip_address: ipAddress
      })

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const error = e as Error
    console.error('POST uploads/complete error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}