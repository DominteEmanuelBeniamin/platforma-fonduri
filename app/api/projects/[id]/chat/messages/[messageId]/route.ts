import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { getClientIP, getUserAgent, logChatMessageAction, toMessagePreview } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { maskProjectChatBodiesForViewer } from '@/app/api/_utils/project-chat-links'
import { serializeProjectChatMessages } from '@/app/api/_utils/project-chat-messages'
import { isProjectChatImagePath } from '@/lib/project-chat-images'
import { PROJECT_CHAT_BUCKET, type StoredChatImage } from '@/lib/project-chat-contracts'

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

function imageRows(value: unknown): StoredChatImage[] {
  if (!Array.isArray(value)) return []
  return value.filter((image): image is StoredChatImage => {
    if (!image || typeof image !== 'object') return false
    const row = image as Partial<StoredChatImage>
    return typeof row.path === 'string' &&
      typeof row.name === 'string' &&
      typeof row.mimeType === 'string' &&
      typeof row.size === 'number'
  })
}

function imageAuditFields(value: unknown) {
  const images = imageRows(value)
  return {
    image_count: images.length,
    image_names: images.map(image => image.name),
  }
}

async function loadMessage(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  projectId: string,
  messageId: string,
) {
  return admin
    .from('project_chat_messages')
    .select(MESSAGE_SELECT)
    .eq('id', messageId)
    .eq('project_id', projectId)
    .maybeSingle()
}

async function loadProjectTitle(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  projectId: string,
) {
  const { data } = await admin.from('projects').select('title').eq('id', projectId).maybeSingle()
  return data?.title ?? projectId
}

function canMutateMessage(role: string, callerId: string, messageCreatedBy: string) {
  return role === 'admin' || callerId === messageCreatedBy
}

async function cleanupUnreferencedImages(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  projectId: string,
  images: unknown,
) {
  const candidates = [...new Set(imageRows(images)
    .map(image => image.path)
    .filter(path => isProjectChatImagePath(path, projectId, path.split('/')[3] ?? '')))]
  if (candidates.length === 0) return

  const referenced = new Set<string>()
  for (const path of candidates) {
    const { data, error } = await admin
      .from('project_chat_messages')
      .select('id')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .contains('images', [{ path }])
      .limit(1)
    if (error) throw error
    if ((data ?? []).length > 0) referenced.add(path)
  }

  const removable = candidates.filter(path => !referenced.has(path))
  if (removable.length === 0) return
  const { error } = await admin.storage.from(PROJECT_CHAT_BUCKET).remove(removable)
  if (error) throw error
}

function parsePatchBody(value: unknown): { ok: true; body: string | null } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Invalid body' }
  const input = value as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(input, 'body') || Object.keys(input).some(key => key !== 'body')) {
    return { ok: false, error: 'PATCH accepts only body' }
  }
  if (input.body !== null && typeof input.body !== 'string') return { ok: false, error: 'body must be a string or null' }
  const body = typeof input.body === 'string' ? input.body.trim() || null : null
  if (body && body.length > 5000) return { ok: false, error: 'body is too long (max 5000 chars)' }
  return { ok: true, body }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const { id: projectId, messageId } = await params
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    const admin = createSupabaseServiceClient()
    const { data, error } = await loadMessage(admin, projectId, messageId)
    if (error) {
      console.error('GET chat message by id failed:', { projectId, messageId, error })
      return Response.json({ error: 'Failed to load chat message' }, { status: 500 })
    }
    if (!data) return Response.json({ error: 'Not Found' }, { status: 404 })

    const visibleRows = await maskProjectChatBodiesForViewer(
      admin,
      access.profile.role,
      projectId,
      [data as ProjectChatMessageRow],
    )
    const [item] = await serializeProjectChatMessages(visibleRows, admin)
    return Response.json({ item })
  } catch (error) {
    console.error('GET chat message by id unexpected error:', error)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const { id: projectId, messageId } = await params
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    const parsed = parsePatchBody(await request.json().catch(() => null))
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

    const admin = createSupabaseServiceClient()
    const { data: message, error: loadError } = await loadMessage(admin, projectId, messageId)
    if (loadError) {
      console.error('PATCH load message failed:', { projectId, messageId, loadError })
      return Response.json({ error: 'Failed to load message' }, { status: 500 })
    }
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 })
    if (message.deleted_at) return Response.json({ error: 'Message is deleted' }, { status: 409 })
    if (parsed.body === null && imageRows(message.images).length === 0) {
      return Response.json({ error: 'Message body or images are required' }, { status: 400 })
    }
    if (!canMutateMessage(access.profile.role, access.user.id, message.created_by)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await admin
      .from('project_chat_messages')
      .update({ body: parsed.body, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('project_id', projectId)
      .select(MESSAGE_SELECT)
      .single()
    if (error || !data) {
      console.error('PATCH message failed:', { projectId, messageId, error })
      return Response.json({ error: 'Failed to update message' }, { status: 500 })
    }

    const projectTitle = await loadProjectTitle(admin, projectId)
    await logChatMessageAction({
      actorId: access.user.id,
      actionType: 'update',
      projectId,
      messageId,
      messagePreview: toMessagePreview(data.body),
      oldValues: {
        project_id: projectId,
        project_title: projectTitle,
        body_preview: toMessagePreview(message.body),
        ...imageAuditFields(message.images),
      },
      newValues: {
        project_id: projectId,
        project_title: projectTitle,
        body_preview: toMessagePreview(data.body),
        ...imageAuditFields(data.images),
      },
      description: `${access.profile.email || 'User'} a editat un mesaj în proiectul "${projectTitle}"`,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
    })

    const visibleRows = await maskProjectChatBodiesForViewer(
      admin,
      access.profile.role,
      projectId,
      [data as ProjectChatMessageRow],
    )
    const [item] = await serializeProjectChatMessages(visibleRows, admin)
    return Response.json({ item })
  } catch (error) {
    console.error('PATCH chat message unexpected error:', error)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const { id: projectId, messageId } = await params
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    const admin = createSupabaseServiceClient()
    const { data: message, error: loadError } = await loadMessage(admin, projectId, messageId)
    if (loadError) {
      console.error('DELETE load message failed:', { projectId, messageId, loadError })
      return Response.json({ error: 'Failed to load message' }, { status: 500 })
    }
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 })
    if (!canMutateMessage(access.profile.role, access.user.id, message.created_by)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (message.deleted_at) {
      const [item] = await serializeProjectChatMessages([message as ProjectChatMessageRow], admin)
      return Response.json({ ok: true, item })
    }

    const deletedAt = new Date().toISOString()
    const { data: deletedMessage, error } = await admin
      .from('project_chat_messages')
      .update({ deleted_at: deletedAt })
      .eq('id', messageId)
      .eq('project_id', projectId)
      .select(MESSAGE_SELECT)
      .single()
    if (error || !deletedMessage) {
      console.error('DELETE (soft) message failed:', { projectId, messageId, error })
      return Response.json({ error: 'Failed to delete message' }, { status: 500 })
    }

    try {
      await cleanupUnreferencedImages(admin, projectId, message.images)
    } catch (storageError) {
      console.error('DELETE chat message image cleanup failed:', {
        projectId,
        messageId,
        error: storageError,
      })
    }

    const projectTitle = await loadProjectTitle(admin, projectId)
    await logChatMessageAction({
      actorId: access.user.id,
      actionType: 'delete',
      projectId,
      messageId,
      messagePreview: toMessagePreview(message.body),
      oldValues: {
        project_id: projectId,
        project_title: projectTitle,
        body_preview: toMessagePreview(message.body),
        ...imageAuditFields(message.images),
      },
      newValues: {
        project_id: projectId,
        project_title: projectTitle,
        deleted_at: deletedAt,
        ...imageAuditFields(message.images),
      },
      description: `${access.profile.email || 'User'} a șters un mesaj în proiectul "${projectTitle}"`,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request),
    })

    const [item] = await serializeProjectChatMessages([deletedMessage as ProjectChatMessageRow], admin)
    return Response.json({ ok: true, item })
  } catch (error) {
    console.error('DELETE chat message unexpected error:', error)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
