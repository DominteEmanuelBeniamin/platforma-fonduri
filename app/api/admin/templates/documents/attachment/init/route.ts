/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'project-files'

// POST /api/admin/templates/documents/attachment/init
// Generează signed upload URL pentru modelul de document dintr-un template
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const type = typeof body?.type === 'string' && body.type
      ? body.type
      : 'application/octet-stream'

    if (!name) {
      return NextResponse.json({ error: 'File name is required' }, { status: 400 })
    }

    const safeName = name.replace(/[^\w.\- ()[\]]+/g, '_')
    const storagePath = `templates/attachments/${Date.now()}_${safeName}`

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath)

    if (error || !data) {
      console.error('createSignedUploadUrl error:', error)
      return NextResponse.json({ error: 'Failed to init upload' }, { status: 500 })
    }

    return NextResponse.json({
      storagePath,
      signedUploadUrl: data.signedUrl,
      token: data.token,
      type,
    })
  } catch (e: any) {
    console.error('POST /api/admin/templates/documents/attachment/init error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}