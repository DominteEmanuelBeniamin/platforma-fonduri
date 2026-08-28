import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { describeDocumentActionFailure } from '@/lib/document-action-idempotency'

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

    const ipAddress =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      null

    const { data: reviewData, error: reviewError } = await admin.rpc('review_document_request', {
      p_request_id: requestId,
      p_action: action,
      p_reason: notes,
      p_reviewed_by: access.user.id,
      p_ip_address: ipAddress,
    })

    if (reviewError) {
      console.error('review_document_request error:', reviewError)
      const failure = describeDocumentActionFailure(reviewError.message, reviewError.code)
      return NextResponse.json(
        { error: reviewError.message, message: failure.message },
        { status: failure.status },
      )
    }

    const reviewResult = Array.isArray(reviewData) ? reviewData[0] : reviewData
    const reviewId = typeof reviewResult?.review_id === 'string' ? reviewResult.review_id : null
    if (!reviewId) {
      console.error('review_document_request returned invalid data:', reviewData)
      return NextResponse.json({ error: 'Failed to save review history' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const error = e as Error
    console.error('POST review error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}
