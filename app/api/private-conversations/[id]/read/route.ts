import { z } from 'zod'
import { guardToResponse } from '@/app/api/_utils/auth'
import { requirePrivateConversationParticipant } from '@/app/api/_utils/private-chat'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const MarkReadSchema = z
  .object({
    readThroughAt: z.iso.datetime({ offset: true }).optional(),
  })
  .optional()

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params

    const accessRes = await requirePrivateConversationParticipant(request, conversationId)
    if (!accessRes.ok) return guardToResponse(accessRes)

    const admin = createSupabaseServiceClient()

    const { data, error } = await admin
      .from('private_conversation_participants')
      .select('user_id, last_read_at')
      .eq('conversation_id', conversationId)

    if (error) {
      console.error('GET private conversation read state failed:', {
        conversationId,
        userId: accessRes.user.id,
        error,
      })
      return Response.json({ error: 'Failed to load read state' }, { status: 500 })
    }

    const otherParticipant = (data ?? []).find((row) => row.user_id !== accessRes.user.id)

    return Response.json({
      ok: true,
      lastReadAt: accessRes.participant.last_read_at,
      otherLastReadAt: otherParticipant?.last_read_at ?? null,
    })
  } catch (err) {
    console.error('GET private conversation read state unexpected error:', err)
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

    const admin = createSupabaseServiceClient()
    const nowIso = new Date().toISOString()
    const bodyJson = await request.json().catch(() => undefined)
    const parsed = MarkReadSchema.safeParse(bodyJson)

    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const readThroughAt = parsed.data?.readThroughAt
    const candidates = [
      nowIso,
      readThroughAt,
      accessRes.participant.last_read_at,
    ].filter((value): value is string => !!value)
    const lastReadAt = candidates.reduce((latest, value) =>
      new Date(value).getTime() > new Date(latest).getTime() ? value : latest
    )

    const { error } = await admin
      .from('private_conversation_participants')
      .update({
        last_read_at: lastReadAt,
      })
      .eq('conversation_id', conversationId)
      .eq('user_id', accessRes.user.id)
      .or(`last_read_at.is.null,last_read_at.lt.${lastReadAt}`)

    if (error) {
      console.error('POST private conversation read failed:', {
        conversationId,
        userId: accessRes.user.id,
        error,
      })
      return Response.json({ error: 'Failed to mark conversation as read' }, { status: 500 })
    }

    return Response.json({ ok: true, lastReadAt })
  } catch (err) {
    console.error('POST private conversation read unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
