import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { logAction } from '@/app/api/_utils/audit'
import { isPreviewableFile } from '@/lib/file-preview'

const BUCKET = 'project-files'

type FileDownloadRow = {
  storage_path: string
  original_name: string | null
  mime_type: string | null
  document_requirements:
    | { project_id: string | null; name: string | null; deleted_at: string | null }
    | Array<{ project_id: string | null; name: string | null; deleted_at: string | null }>
    | null
}

function getDownloadName(fileRow: FileDownloadRow) {
  const originalName = typeof fileRow.original_name === 'string' ? fileRow.original_name.trim() : ''
  if (originalName) return originalName
  return fileRow.storage_path.split('/').filter(Boolean).pop() || 'fisier'
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params
    const body = await request.json().catch(() => ({}))
    const expiresIn = typeof body?.expiresIn === 'number' ? body.expiresIn : 60 * 5
    const inlineRequested = body?.disposition === 'inline'

    const admin = createSupabaseServiceClient()

    const { data: fileRow, error } = await admin
      .from('files')
      .select('id, storage_path, original_name, mime_type, requirement_id, deleted_at, document_requirements(project_id, name, deleted_at)')
      .eq('id', fileId)
      .is('deleted_at', null)
      .single()

    if (error || !fileRow) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const typedFileRow = fileRow as FileDownloadRow
    const relation = typedFileRow.document_requirements
    const requirement = Array.isArray(relation) ? relation[0] : relation
    if (requirement?.deleted_at) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const projectId = requirement?.project_id ?? undefined
    if (!projectId) {
      return NextResponse.json({ error: 'Invalid file relation' }, { status: 500 })
    }

    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    const { data: projectRow } = await admin
      .from('projects')
      .select('title')
      .eq('id', projectId)
      .maybeSingle()
    const projectTitle = projectRow?.title ?? projectId
    const requirementName = requirement?.name || null

    // inline doar pentru tipuri afișabile în browser; altfel forțăm descărcarea
    const inline = inlineRequested && isPreviewableFile({
      mimeType: typedFileRow.mime_type,
      fileName: getDownloadName(typedFileRow),
    })

    const { data, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(typedFileRow.storage_path, expiresIn, {
        download: inline ? false : getDownloadName(typedFileRow),
      })

    if (signErr || !data?.signedUrl) {
      console.error('signed url error:', signErr)
      return NextResponse.json({ error: 'Failed to create signed download URL' }, { status: 500 })
    }

    await logAction({
      actorId: access.user.id,
      actionType: 'download',
      entityType: 'file_access',
      entityId: fileId,
      entityName: getDownloadName(typedFileRow),
      newValues: {
        file_id: fileId,
        project_id: projectId,
        project_title: projectTitle,
        document_request_name: requirementName,
        storage_path: typedFileRow.storage_path,
        expires_in: expiresIn,
        disposition: inline ? 'inline' : 'attachment',
      },
      description: `${inline ? 'Vizualizare' : 'Descarcare'} fisier "${getDownloadName(typedFileRow)}" din proiectul "${projectTitle}"${requirementName ? ` pentru cererea "${requirementName}"` : ''}`,
      request,
    })

    return NextResponse.json({ url: data.signedUrl })
  } catch (e: unknown) {
    console.error('POST signed-download error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
