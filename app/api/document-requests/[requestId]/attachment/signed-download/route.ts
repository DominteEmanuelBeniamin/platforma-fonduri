import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const BUCKET = 'project-files'

async function signedObjectExists(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function markAttachmentMissing(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  reqRow: {
    attachment_path: string
    attachment_missing_at: string | null
  }
) {
  const checkedAt = new Date().toISOString()
  const missingAt = reqRow.attachment_missing_at ?? checkedAt

  await Promise.all([
    admin
      .from('document_requirements')
      .update({
        attachment_missing_at: missingAt,
        attachment_missing_checked_at: checkedAt,
      })
      .eq('attachment_path', reqRow.attachment_path)
      .is('deleted_at', null),
    admin
      .from('template_document_requirements')
      .update({
        attachment_missing_at: missingAt,
        attachment_missing_checked_at: checkedAt,
      })
      .eq('attachment_path', reqRow.attachment_path),
  ])
}

async function clearAttachmentMissing(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  reqRow: {
    attachment_path: string
  }
) {
  const checkedAt = new Date().toISOString()

  await Promise.all([
    admin
      .from('document_requirements')
      .update({
        attachment_missing_at: null,
        attachment_missing_checked_at: checkedAt,
      })
      .eq('attachment_path', reqRow.attachment_path)
      .is('deleted_at', null),
    admin
      .from('template_document_requirements')
      .update({
        attachment_missing_at: null,
        attachment_missing_checked_at: checkedAt,
      })
      .eq('attachment_path', reqRow.attachment_path),
  ])
}

function missingAttachmentResponse() {
  return NextResponse.json(
    { error: 'Modelul atașat este momentan indisponibil. Echipa a fost notificată.' },
    { status: 404 }
  )
}

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
      .select('project_id, attachment_path, attachment_original_name, attachment_missing_at, deleted_at')
      .eq('id', requestId)
      .is('deleted_at', null)
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
      .createSignedUrl(reqRow.attachment_path, expiresIn, {
        download: reqRow.attachment_original_name || true,
      })

    if (signErr || !data?.signedUrl) {
      console.error('signed url error:', signErr)
      await markAttachmentMissing(admin, {
        attachment_path: reqRow.attachment_path,
        attachment_missing_at: reqRow.attachment_missing_at,
      })
      return missingAttachmentResponse()
    }

    const exists = await signedObjectExists(data.signedUrl)
    if (!exists) {
      await markAttachmentMissing(admin, {
        attachment_path: reqRow.attachment_path,
        attachment_missing_at: reqRow.attachment_missing_at,
      })
      return missingAttachmentResponse()
    }

    if (reqRow.attachment_missing_at) {
      await clearAttachmentMissing(admin, {
        attachment_path: reqRow.attachment_path,
      })
    }

    return NextResponse.json({ url: data.signedUrl })
  } catch (e: unknown) {
    console.error('POST attachment/signed-download error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
