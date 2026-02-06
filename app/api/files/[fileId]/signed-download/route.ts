import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const BUCKET = 'project-files'

export async function POST(request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params
    const body = await request.json().catch(() => ({}))
    const expiresIn = typeof body?.expiresIn === 'number' ? body.expiresIn : 60 * 5 // 5 min

    const admin = createSupabaseServiceClient()

    // Load file + project_id (via relationship)
    const { data: fileRow, error } = await admin
      .from('files')
      .select('id, storage_path, requirement_id, document_requirements(project_id)')
      .eq('id', fileId)
      .single()

    if (error || !fileRow) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const projectId = (fileRow as any).document_requirements?.project_id as string | undefined
    if (!projectId) {
      return NextResponse.json({ error: 'Invalid file relation' }, { status: 500 })
    }

    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    // Signed URL
    const { data, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(
      (fileRow as any).storage_path, expiresIn, { download: true }
    )



    if (signErr || !data?.signedUrl) {
      console.error('signed url error:', signErr)
      return NextResponse.json({ error: 'Failed to create signed download URL' }, { status: 500 })
    }

    return NextResponse.json({ url: data.signedUrl })
  } catch (e: any) {
    console.error('POST signed-download error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
