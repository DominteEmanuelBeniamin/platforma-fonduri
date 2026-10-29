import { z } from 'zod'
import { guardToResponse } from '@/app/api/_utils/auth'
import { requirePrivateConversationParticipant } from '@/app/api/_utils/private-chat'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { logAction } from '@/app/api/_utils/audit'
import { inactiveReferenceConflict } from '@/app/api/_utils/inactive-reference'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const CursorDateTimeSchema = z.iso.datetime({ offset: true })

const CursorSchema = z.string().superRefine((cursor, context) => {
  const separator = cursor.lastIndexOf('|')
  const timestamp = separator === -1 ? cursor : cursor.slice(0, separator)

  if (!CursorDateTimeSchema.safeParse(timestamp).success) {
    context.addIssue({ code: 'custom', message: 'Cursor timestamp must be an ISO datetime' })
  }

  if (separator !== -1 && !UUID_PATTERN.test(cursor.slice(separator + 1))) {
    context.addIssue({ code: 'custom', message: 'Cursor id must be a UUID' })
  }
})

const GetQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: CursorSchema.optional(),
})

type MessageCursor = { createdAt: string; id: string | null }

type ParsedQueryOk = {
  ok: true
  data: {
    limit: number
    cursor: MessageCursor | null
  }
}

type ParsedQueryErr = {
  ok: false
  error: z.ZodError
}

function parseQuery(request: Request): ParsedQueryOk | ParsedQueryErr {
  const url = new URL(request.url)

  const raw = {
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  }

  const parsed = GetQuerySchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error }

  const { limit, cursor } = parsed.data
  const separator = cursor?.lastIndexOf('|') ?? -1
  const parsedCursor = cursor
    ? {
        createdAt: separator === -1 ? cursor : cursor.slice(0, separator),
        id: separator === -1 ? null : cursor.slice(separator + 1),
      }
    : null

  return {
    ok: true,
    data: { limit, cursor: parsedCursor },
  }
}

const CreateMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
})

type MaskableMessageRow = {
  body: string | null
  deleted_at: string | null
}

const maskRow = <T extends MaskableMessageRow>(m: T) => {
  if (!m?.deleted_at) return { ...m, is_deleted: false }
  return {
    ...m,
    body: null,
    is_deleted: true,
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params

    const accessRes = await requirePrivateConversationParticipant(request, conversationId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const parsed = parseQuery(request)
    if (!parsed.ok) {
      return Response.json(
        { error: 'Invalid query params', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const { limit, cursor } = parsed.data
    const admin = createSupabaseServiceClient()

    const requested = limit
    const pageSize = requested + 1

    let q = admin
      .from('private_messages')
      .select(`
        id,
        conversation_id,
        created_by,
        body,
        created_at,
        edited_at,
        deleted_at,
        profiles:created_by (
          id,
          full_name,
          email,
          is_active
        )
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize)

    if (cursor?.id) {
      q = q.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
    } else if (cursor) {
      q = q.lt('created_at', cursor.createdAt)
    }

    const { data, error } = await q

    if (error) {
      console.error('GET private messages failed:', { conversationId, error })
      return Response.json({ error: 'Failed to load private messages' }, { status: 500 })
    }

    const rows = (data ?? []).map(maskRow)
    const hasMore = rows.length > requested
    const items = hasMore ? rows.slice(0, requested) : rows
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? `${lastItem.created_at}|${lastItem.id}` : null

    return Response.json({ items, nextCursor })
  } catch (err) {
    console.error('GET private messages unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params

    const accessRes = await requirePrivateConversationParticipant(request, conversationId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const bodyJson = await request.json().catch(() => null)
    const parsed = CreateMessageSchema.safeParse(bodyJson)

    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const admin = createSupabaseServiceClient()

    const { data: recipients, error: recipientsError } = await admin
      .from('private_conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .neq('user_id', accessRes.user.id)

    if (recipientsError) {
      console.error('POST private message recipient lookup failed:', { conversationId, error: recipientsError })
      return Response.json({ error: 'Failed to verify conversation recipient' }, { status: 500 })
    }

    const recipientIds = [...new Set((recipients ?? []).map(row => row.user_id))]
    if (recipientIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from('profiles')
        .select('id, is_active')
        .in('id', recipientIds)
      if (profilesError) {
        console.error('POST private message recipient status lookup failed:', { conversationId, error: profilesError })
        return Response.json({ error: 'Failed to verify conversation recipient' }, { status: 500 })
      }
      if ((profiles ?? []).some(profile => profile.is_active === false)) {
        return Response.json({ error: 'Nu poți trimite un mesaj unui cont dezactivat' }, { status: 409 })
      }
    }

    const insertPayload = {
      conversation_id: conversationId,
      created_by: accessRes.user.id,
      body: parsed.data.body,
    }

    const { data, error } = await admin
      .from('private_messages')
      .insert(insertPayload)
      .select(`
        id,
        conversation_id,
        created_by,
        body,
        created_at,
        edited_at,
        deleted_at,
        profiles:created_by (
          id,
          full_name,
          email,
          is_active
        )
      `)
      .single()

    if (error || !data) {
      const inactive = inactiveReferenceConflict(error, 'Nu poți trimite un mesaj folosind un cont dezactivat.')
      if (inactive) return Response.json(inactive.body, { status: inactive.status })
      console.error('POST private message failed:', { conversationId, error })
      return Response.json({ error: 'Failed to create private message' }, { status: 500 })
    }

    const nowIso = new Date().toISOString()
    await admin
      .from('private_conversations')
      .update({ last_message_at: nowIso })
      .eq('id', conversationId)

    await logAction({
      actorId: accessRes.user.id,
      actionType: 'create',
      entityType: 'private_message',
      entityId: data.id,
      entityName: `msg:${data.id}`,
      newValues: { conversation_id: conversationId },
      description: `Trimitere mesaj privat in conversatia ${conversationId}`,
      request,
    })

    return Response.json({ item: data }, { status: 201 })
  } catch (err) {
    console.error('POST private message unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
