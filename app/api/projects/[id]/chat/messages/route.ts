import { z } from 'zod'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { getClientIP, getUserAgent, logChatMessageAction, toMessagePreview } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { maskProjectChatBodiesForViewer } from '@/app/api/_utils/project-chat-links'
import { serializeProjectChatMessages } from '@/app/api/_utils/project-chat-messages'
import {
  mimeTypeFromProjectChatImageName,
  parseProjectChatMessageInput,
  toStoredProjectChatImage,
} from '@/lib/project-chat-images'
import { removeUnreferencedProjectChatImages } from '@/app/api/_utils/project-chat-image-refs'
import {
  PROJECT_CHAT_BUCKET,
  PROJECT_CHAT_MAX_IMAGE_BYTES,
  type ChatImageReference,
  type StoredChatImage,
} from '@/lib/project-chat-contracts'
import { insertProjectChatMessageWithCleanup } from '@/lib/project-chat-post'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50
const MESSAGE_SELECT = `
  id,
  project_id,
  created_by,
  body,
  images,
  created_at,
  edited_at,
  deleted_at,
  profiles:created_by (
    id,
    full_name,
    email
  )
`

const GetQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.iso.datetime({ offset: true }).optional(),
})

type ParsedQueryOk = {
  ok: true
  data: { limit: number; cursor: string | undefined; cursorIso: string | null }
}

type ParsedQueryErr = { ok: false; error: z.ZodError }

export function parseQuery(request: Request): ParsedQueryOk | ParsedQueryErr {
  const url = new URL(request.url)
  const parsed = GetQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  })
  if (!parsed.success) return { ok: false, error: parsed.error }
  return {
    ok: true,
    data: {
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
      cursorIso: parsed.data.cursor ? new Date(parsed.data.cursor).toISOString() : null,
    },
  }
}

type ProjectChatMessageRow = {
  id: string
  project_id: string
  created_by: string
  body: string | null
  images?: unknown
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  profiles?: unknown
}

async function inspectStoredImages(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  images: ChatImageReference[],
): Promise<StoredChatImage[] | null> {
  const result = await Promise.all(images.map(async image => {
    try {
      const { data, error } = await admin.storage.from(PROJECT_CHAT_BUCKET).info(image.path)
      if (error || !data) return null
      const stored = toStoredProjectChatImage(image.path, image.name, data)
      if (!stored || stored.size < 1 || stored.size > PROJECT_CHAT_MAX_IMAGE_BYTES) return null
      const extensionMime = mimeTypeFromProjectChatImageName(stored.name)
      if (extensionMime && extensionMime !== stored.mimeType) return null
      return stored
    } catch {
      return null
    }
  }))
  return result.every((image): image is StoredChatImage => image !== null) ? result : null
}

async function cleanupUnreferencedPostImages(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  projectId: string,
  userId: string,
  paths: readonly string[],
): Promise<void> {
  try {
    // The insert may have committed even when its HTTP response was lost. The
    // reference check makes this cleanup safe for that ambiguous outcome: a
    // path stored by the newly-created message is skipped instead of removed.
    await removeUnreferencedProjectChatImages(admin, projectId, paths)
  } catch (cleanupError) {
    console.error('POST chat message orphan image cleanup failed:', {
      projectId,
      userId,
      count: paths.length,
      error: cleanupError,
    })
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    const parsed = parseQuery(request)
    if (!parsed.ok) {
      return Response.json({ error: 'Invalid query params', details: z.treeifyError(parsed.error) }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()
    const { limit, cursorIso } = parsed.data
    let query = admin
      .from('project_chat_messages')
      .select(MESSAGE_SELECT)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit + 1)
    if (cursorIso) query = query.lt('created_at', cursorIso)

    const { data, error } = await query
    if (error) {
      console.error('GET chat messages failed:', { projectId, error })
      return Response.json({ error: 'Failed to load chat messages' }, { status: 500 })
    }

    const rows = (data ?? []) as ProjectChatMessageRow[]
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const visibleItems = await maskProjectChatBodiesForViewer(
      admin,
      access.profile.role,
      projectId,
      items,
    )
    const serialized = await serializeProjectChatMessages(visibleItems, admin)
    return Response.json({
      items: serialized,
      nextCursor: hasMore ? (items[items.length - 1]?.created_at ?? null) : null,
    })
  } catch (error) {
    console.error('GET chat messages unexpected error:', error)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    const parsed = parseProjectChatMessageInput(await request.json().catch(() => null), projectId, access.user.id)
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

    const admin = createSupabaseServiceClient()
    const storedImages = await inspectStoredImages(admin, parsed.data.images)
    if (!storedImages) {
      // Dimensiunea trimisă la `init` vine de la client, deci abia aici se află
      // cât s-a urcat de fapt. Obiectele respinse se șterg pe loc: altfel un
      // client care nu mai cheamă `/cleanup` ar putea umple bucket-ul urcând
      // fișiere mari sub o dimensiune declarată mică. Trecem prin verificarea de
      // referințe, nu prin `remove` direct — nimic nu împiedică lotul respins să
      // conțină și un path pe care îl mai ține un mesaj trimis mai devreme.
      await cleanupUnreferencedPostImages(
        admin,
        projectId,
        access.user.id,
        parsed.data.images.map(image => image.path),
      )
      return Response.json({ error: 'One or more uploaded images are missing or invalid' }, { status: 400 })
    }

    const imagePaths = parsed.data.images.map(image => image.path)
    let projectTitle = projectId
    const insertion = await insertProjectChatMessageWithCleanup(async () => {
      const { data: projectRow } = await admin
        .from('projects')
        .select('title')
        .eq('id', projectId)
        .maybeSingle()
      projectTitle = projectRow?.title ?? projectId

      const result = await admin
        .from('project_chat_messages')
        .insert({
          project_id: projectId,
          created_by: access.user.id,
          body: parsed.data.body,
          images: storedImages,
        })
        .select(MESSAGE_SELECT)
        .single()

      return {
        data: result.data as ProjectChatMessageRow | null,
        error: result.error,
      }
    }, () => cleanupUnreferencedPostImages(admin, projectId, access.user.id, imagePaths))

    if (!insertion.ok) {
      console.error(
        insertion.kind === 'transport' ? 'POST chat message transport failed:' : 'POST chat message failed:',
        { projectId, error: insertion.error },
      )
      return Response.json({ error: 'Failed to create chat message' }, { status: 500 })
    }
    const data = insertion.data

    await logChatMessageAction({
      actorId: access.user.id,
      actionType: 'create',
      projectId,
      messageId: data.id,
      messagePreview: toMessagePreview(data.body),
      newValues: {
        project_id: data.project_id,
        project_title: projectTitle,
        created_by: data.created_by,
        body_preview: toMessagePreview(data.body),
        image_count: storedImages.length,
        image_names: storedImages.map(image => image.name),
      },
      description: `${access.profile.email || 'User'} a trimis un mesaj în proiectul "${projectTitle}"`,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
    })

    const visibleRows = await maskProjectChatBodiesForViewer(
      admin,
      access.profile.role,
      projectId,
      [data],
    )
    const [item] = await serializeProjectChatMessages(visibleRows, admin)
    return Response.json({ item }, { status: 201 })
  } catch (error) {
    console.error('POST chat message unexpected error:', error)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
