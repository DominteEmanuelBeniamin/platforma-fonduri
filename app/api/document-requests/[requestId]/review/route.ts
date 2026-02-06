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
      .select('id, project_id, status')
      .eq('id', requestId)
      .single()

    if (reqErr || !reqRow) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    const access = await requireProjectAccess(request, reqRow.project_id)
    if (!access.ok) return guardToResponse(access)

    const { data: lastFile, error: fileErr } = await admin
      .from('files')
      .select('id, created_at')
      .eq('requirement_id', requestId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fileErr) {
      console.error('last file fetch error:', fileErr)
      return NextResponse.json({ error: 'Failed to load request files' }, { status: 500 })
    }

    //if (!lastFile?.id) return NextResponse.json({ error: 'No uploaded files' }, { status: 400 })

    if (notes && lastFile?.id) {
      const { error: updFileErr } = await admin
        .from('files')
        .update({ comments: notes })
        .eq('id', lastFile.id)

      if (updFileErr) {
        console.error('update file comments error:', updFileErr)
        return NextResponse.json({ error: 'Failed to save notes' }, { status: 500 })
      }
    }

    const { error: updReqErr } = await admin
      .from('document_requirements')
      .update({ status: action })
      .eq('id', requestId)

    if (updReqErr) {
      console.error('update requirement status error:', updReqErr)
      return NextResponse.json({ error: 'Failed to update request status' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('POST review error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
