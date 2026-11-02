import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { logAction } from '@/app/api/_utils/audit'
import { isPreviewableFile, clampExpiresIn } from '@/lib/file-preview'
import { readableFile } from '@/app/api/_utils/file-access'

const BUCKET = 'project-files'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params
    const body = await request.json().catch(() => ({}))
    const expiresIn = clampExpiresIn(body?.expiresIn)
    const inlineRequested = body?.disposition === 'inline'

    const readable = await readableFile(request, fileId)
    if (!readable.ok) return readable.response
    const { access, file: typedFileRow, fileName, projectId, projectTitle, requirementName } = readable.value
    const admin = createSupabaseServiceClient()

    // inline doar pentru tipuri afișabile în browser; altfel forțăm descărcarea
    const inline = inlineRequested && isPreviewableFile({
      mimeType: typedFileRow.mime_type,
      fileName,
    })

    const { data, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(typedFileRow.storage_path, expiresIn, {
        download: inline ? false : fileName,
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
      entityName: fileName,
      newValues: {
        file_id: fileId,
        project_id: projectId,
        project_title: projectTitle,
        document_request_name: requirementName,
        storage_path: typedFileRow.storage_path,
        expires_in: expiresIn,
        disposition: inline ? 'inline' : 'attachment',
      },
      description: `${inline ? 'Vizualizare' : 'Descarcare'} fisier "${fileName}" din proiectul "${projectTitle}"${requirementName ? ` pentru cererea "${requirementName}"` : ''}`,
      request,
    })

    return NextResponse.json({ url: data.signedUrl })
  } catch (e: unknown) {
    console.error('POST signed-download error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
