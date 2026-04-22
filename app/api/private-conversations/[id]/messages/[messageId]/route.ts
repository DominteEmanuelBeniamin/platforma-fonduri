import { z } from 'zod'
import { guardToResponse } from '@/app/api/_utils/auth'
import {
  requirePrivateConversationParticipant,
  requirePrivateMessageOwner,
} from '@/app/api/_utils/private-chat'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const UpdateMessageSchema = z.object({
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
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id: conversationId, messageId } = await params

    const accessRes = await requirePrivateConversationParticipant(request, conversationId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const admin = createSupabaseServiceClient()

    const { data, error } = await admin
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
          email
        )
      `)
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .maybeSingle()

    if (error) {
      console.error('GET private message failed:', {
        conversationId,
        messageId,
        error,
      })
      return Response.json({ error: 'Failed to load private message' }, { status: 500 })
    }

    if (!data) {
      return Response.json({ error: 'Message not found' }, { status: 404 })
    }

    return Response.json({ item: maskRow(data) })
  } catch (err) {
    console.error('GET private message unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id: conversationId, messageId } = await params

    const accessRes = await requirePrivateConversationParticipant(request, conversationId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const ownerRes = await requirePrivateMessageOwner(request, messageId)
    if (!ownerRes.ok) return guardToResponse(ownerRes)

    if (ownerRes.message.conversation_id !== conversationId) {
      return Response.json({ error: 'Message does not belong to this conversation' }, { status: 400 })
    }

    if (ownerRes.message.deleted_at) {
      return Response.json({ error: 'Deleted messages cannot be edited' }, { status: 400 })
    }

    const bodyJson = await request.json().catch(() => null)
    const parsed = UpdateMessageSchema.safeParse(bodyJson)

    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const admin = createSupabaseServiceClient()
    const nowIso = new Date().toISOString()

    const { data, error } = await admin
      .from('private_messages')
      .update({
        body: parsed.data.body,
        edited_at: nowIso,
      })
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
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
          email
        )
      `)
      .single()

    if (error || !data) {
      console.error('PATCH private message failed:', {
        conversationId,
        messageId,
        error,
      })
      return Response.json({ error: 'Failed to update private message' }, { status: 500 })
    }

    return Response.json({ item: maskRow(data) })
  } catch (err) {
    console.error('PATCH private message unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id: conversationId, messageId } = await params

    const accessRes = await requirePrivateConversationParticipant(request, conversationId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const ownerRes = await requirePrivateMessageOwner(request, messageId)
    if (!ownerRes.ok) return guardToResponse(ownerRes)

    if (ownerRes.message.conversation_id !== conversationId) {
      return Response.json({ error: 'Message does not belong to this conversation' }, { status: 400 })
    }

    if (ownerRes.message.deleted_at) {
      return Response.json({ ok: true })
    }

    const admin = createSupabaseServiceClient()
    const nowIso = new Date().toISOString()

    const { error } = await admin
      .from('private_messages')
      .update({
        deleted_at: nowIso,
      })
      .eq('id', messageId)
      .eq('conversation_id', conversationId)

    if (error) {
      console.error('DELETE private message failed:', {
        conversationId,
        messageId,
        error,
      })
      return Response.json({ error: 'Failed to delete private message' }, { status: 500 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('DELETE private message unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
