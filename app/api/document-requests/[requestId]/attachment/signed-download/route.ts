import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const BUCKET = 'project-files'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params 
    const body = await request.json().catch(() => ({}))
    const expiresIn = typeof body?.expiresIn === 'number' ? body.expiresIn : 60 * 5

    const admin = createSupabaseServiceClient()

    const { data: reqRow, error: reqErr } = await admin
      .from('document_requirements')
      .select('id, project_id, attachment_path')
      .eq('id', requestId)
      .single()

    if (reqErr || !reqRow) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    const access = await requireProjectAccess(request, reqRow.project_id)
    if (!access.ok) return guardToResponse(access)

    if (!reqRow.attachment_path) {
      return NextResponse.json({ error: 'No attachment on this request' }, { status: 404 })
    }

    const { data, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(reqRow.attachment_path, expiresIn, { download: true })

    if (signErr || !data?.signedUrl) {
      console.error('signed url error:', signErr)
      return NextResponse.json({ error: 'Failed to create signed download URL' }, { status: 500 })
    }

    return NextResponse.json({ url: data.signedUrl })
  } catch (e: any) {
    console.error('POST attachment/signed-download error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
