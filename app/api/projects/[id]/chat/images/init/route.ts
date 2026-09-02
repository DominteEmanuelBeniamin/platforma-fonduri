import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import {
  buildProjectChatImagePath,
  validateProjectChatImageUploads,
} from '@/lib/project-chat-images'
import { PROJECT_CHAT_BUCKET } from '@/lib/project-chat-contracts'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params
  const access = await requireProjectAccess(request, projectId)
  if (!access.ok) return guardToResponse(access)

  const body = await request.json().catch(() => null)
  const validation = validateProjectChatImageUploads(body && typeof body === 'object' ? (body as { files?: unknown }).files : null)
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 })

  const admin = createSupabaseServiceClient()
  const initializedPaths: string[] = []

  try {
    const uploads = []
    for (const [clientFileId, file] of validation.files.entries()) {
      const path = buildProjectChatImagePath(projectId, access.user.id, file.name)
      const { data, error } = await admin.storage
        .from(PROJECT_CHAT_BUCKET)
        .createSignedUploadUrl(path)

      if (error || !data?.signedUrl || !data.token) {
        throw new Error(`Failed to sign upload for image ${clientFileId + 1}`)
      }

      initializedPaths.push(path)
      uploads.push({
        clientFileId,
        path,
        mimeType: file.mimeType,
        signedUploadUrl: data.signedUrl,
        token: data.token,
      })
    }

    return Response.json({ uploads })
  } catch (error) {
    if (initializedPaths.length > 0) {
      const { error: cleanupError } = await admin.storage
        .from(PROJECT_CHAT_BUCKET)
        .remove(initializedPaths)
      if (cleanupError) {
        console.error('Project chat image init cleanup failed:', {
          projectId,
          userId: access.user.id,
          count: initializedPaths.length,
          error: cleanupError,
        })
      }
    }
    console.error('Project chat image init failed:', {
      projectId,
      userId: access.user.id,
      count: validation.files.length,
      error,
    })
    return Response.json({ error: 'Failed to initialize image upload' }, { status: 500 })
  }
}
