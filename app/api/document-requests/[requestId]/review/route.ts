import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

type Action = 'approved' | 'rejected'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const body = await request.json().catch(() => null)

    const action = body?.action as Action | undefined
    const notesRaw = typeof body?.notes === 'string' ? body.notes : null
    const notes = notesRaw?.trim() ? notesRaw.trim() : null

    if (action !== 'approved' && action !== 'rejected') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
    if (action === 'rejected' && !notes) {
      return NextResponse.json({ error: 'Notes are required for rejection' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    const { data: reqRow, error: reqErr } = await admin
      .from('document_requirements')
      .select('id, project_id, status, name, is_outgoing, deleted_at')
      .eq('id', requestId)
      .is('deleted_at', null)
      .single()

    if (reqErr || !reqRow) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }
    if (reqRow.is_outgoing) {
      return NextResponse.json({ error: 'Documentele trimise clientului nu intră în fluxul de review.' }, { status: 400 })
    }

    const access = await requireProjectAccess(request, reqRow.project_id)
    if (!access.ok) return guardToResponse(access)
    if (access.profile.role === 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: latestFile, error: fileErr } = await admin
      .from('files')
      .select('id, version_number, created_at')
      .eq('requirement_id', requestId)
      .is('deleted_at', null)
      .order('version_number', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fileErr) {
      console.error('last file fetch error:', fileErr)
      return NextResponse.json({ error: 'Failed to load request files' }, { status: 500 })
    }
    if (!latestFile?.version_number) {
      return NextResponse.json({ error: 'No uploaded files to review' }, { status: 400 })
    }

    const { error: reviewInsertErr } = await admin
      .from('document_request_reviews')
      .insert({
        requirement_id: requestId,
        action,
        reason: action === 'rejected' ? notes : null,
        reviewed_version_number: latestFile.version_number,
        reviewed_by: access.user.id,
      })

    if (reviewInsertErr) {
      console.error('document_request_reviews insert error:', reviewInsertErr)
      return NextResponse.json({ error: 'Failed to save review history' }, { status: 500 })
    }

    const { error: updReqErr } = await admin
      .from('document_requirements')
      .update({ status: action })
      .eq('id', requestId)
      .is('deleted_at', null)

    if (updReqErr) {
      console.error('update requirement status error:', updReqErr)
      return NextResponse.json({ error: 'Failed to update request status' }, { status: 500 })
    }

    const ipAddress =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      null

    await admin.from('audit_logs').insert({
      user_id: access.user.id,
      action_type: 'update',
      entity_type: 'document',
      entity_id: requestId,
      entity_name: reqRow.name || 'Document',
      old_values: {
        status: reqRow.status,
      },
      new_values: {
        status: action,
        reviewed_version_number: latestFile.version_number,
        reason: action === 'rejected' ? notes : undefined,
      },
      description: `${access.profile.email || 'User'} a ${action === 'approved' ? 'aprobat' : 'respins'} documentul "${reqRow.name || requestId}"${notes ? ` cu motivul: ${notes}` : ''}`,
      ip_address: ipAddress,
    })

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const error = e as Error
    console.error('POST review error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}
