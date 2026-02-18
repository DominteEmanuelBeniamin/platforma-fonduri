/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const BUCKET = 'project-files'

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return guardToResponse(auth)

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const type = typeof body?.type === 'string' && body.type ? body.type : 'application/octet-stream'

    if (!name) {
      return NextResponse.json({ error: 'File name is required' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    const safeName = name.replace(/[^\w.\- ()[\]]+/g, '_')
    const storagePath = `templates/attachments/${Date.now()}_${safeName}`

    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath)

    if (error || !data) {
      console.error('createSignedUploadUrl error:', error)
      return NextResponse.json({ error: 'Failed to init upload' }, { status: 500 })
    }

    return NextResponse.json({
      storagePath,
      signedUploadUrl: data.signedUrl,
      token: data.token,
      type
    })
  } catch (e: any) {
    console.error('POST /api/admin/templates/attachment/init error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}