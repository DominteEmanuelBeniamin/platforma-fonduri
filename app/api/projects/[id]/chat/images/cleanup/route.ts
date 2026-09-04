import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { removeUnreferencedProjectChatImages } from '@/app/api/_utils/project-chat-image-refs'
import { isProjectChatImagePath } from '@/lib/project-chat-images'
import { PROJECT_CHAT_MAX_IMAGES } from '@/lib/project-chat-contracts'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params
  const access = await requireProjectAccess(request, projectId)
  if (!access.ok) return guardToResponse(access)

  const body = await request.json().catch(() => null)
  const paths = body && typeof body === 'object' ? (body as { paths?: unknown }).paths : null
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > PROJECT_CHAT_MAX_IMAGES) {
    return Response.json({ error: `paths[] must contain 1..${PROJECT_CHAT_MAX_IMAGES} images` }, { status: 400 })
  }
  if (paths.some(path => typeof path !== 'string' || !isProjectChatImagePath(path, projectId, access.user.id))) {
    return Response.json({ error: 'Invalid project chat image path' }, { status: 400 })
  }

  const uniquePaths = [...new Set(paths as string[])]
  if (uniquePaths.length !== paths.length) {
    return Response.json({ error: 'paths[] must not contain duplicates' }, { status: 400 })
  }

  try {
    const { removed, skipped } = await removeUnreferencedProjectChatImages(
      createSupabaseServiceClient(),
      projectId,
      uniquePaths,
    )
    return Response.json({ ok: true, removedPaths: removed, skippedPaths: skipped })
  } catch (error) {
    console.error('Project chat image cleanup failed:', {
      projectId,
      userId: access.user.id,
      count: uniquePaths.length,
      error,
    })
    return Response.json({ error: 'Failed to remove unused images' }, { status: 500 })
  }
}
