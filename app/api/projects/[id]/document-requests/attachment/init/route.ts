import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const BUCKET = 'project-files'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id:projectId } = await params
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    // doar admin/consultant pot încărca template
    if (access.profile.role !== 'admin' && access.profile.role !== 'consultant') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const type = typeof body?.type === 'string' && body.type ? body.type : 'application/octet-stream'

    if (!name) return NextResponse.json({ error: 'File name is required' }, { status: 400 })

    const admin = createSupabaseServiceClient()

    const safeName = name.replace(/[^\w.\- ()[\]]+/g, '_')
    const storagePath = `${projectId}/cereri/${Date.now()}_${safeName}`

    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath)

    if (error || !data) {
      console.error('createSignedUploadUrl error:', error)
      return NextResponse.json({ error: 'Failed to init upload' }, { status: 500 })
    }

    // Important: Supabase upload signed URL folosește token + PUT cu Authorization Bearer token
    return NextResponse.json({
      storagePath,
      signedUploadUrl: data.signedUrl,
      token: data.token,
      type
    })
  } catch (e: any) {
    console.error('attachment/init exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
