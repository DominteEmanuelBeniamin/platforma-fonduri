import { z } from 'zod'
import { guardToResponse } from '@/app/api/_utils/auth'
import { requirePrivateConversationParticipant } from '@/app/api/_utils/private-chat'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { chatTimestampMicroseconds } from '@/lib/chat-timestamp'

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>

/** Ora celui mai nou mesaj din conversație, în ceasul bazei de date (0 dacă nu există sau nu răspunde). */
async function newestMessageMicroseconds(admin: ServiceClient, conversationId: string) {
  const { data, error } = await admin
    .from('private_messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data?.created_at) return 0
  return chatTimestampMicroseconds(data.created_at)
}

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
    const requestTimeIso = new Date().toISOString()
    const bodyJson = await request.json().catch(() => undefined)
    const parsed = MarkReadSchema.safeParse(bodyJson)

    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const readThroughAt = parsed.data?.readThroughAt
    // Un marcaj din viitor e plafonat. Ora unui mesaj existent e mereu acceptată, chiar dacă
    // ceasul bazei de date e înaintea celui al serverului de aplicație.
    const ceiling = readThroughAt
      ? Math.max(chatTimestampMicroseconds(requestTimeIso), await newestMessageMicroseconds(admin, conversationId))
      : 0
    const requestedReadThroughAt = readThroughAt &&
      chatTimestampMicroseconds(readThroughAt) <= ceiling
      ? readThroughAt
      : requestTimeIso
    const currentLastReadAt = accessRes.participant.last_read_at
    const lastReadAt = currentLastReadAt &&
      chatTimestampMicroseconds(currentLastReadAt) > chatTimestampMicroseconds(requestedReadThroughAt)
      ? currentLastReadAt
      : requestedReadThroughAt

    const { error: updateError } = await admin
      .from('private_conversation_participants')
      .update({
        last_read_at: lastReadAt,
      })
      .eq('conversation_id', conversationId)
      .eq('user_id', accessRes.user.id)
      .or(`last_read_at.is.null,last_read_at.lt.${lastReadAt}`)

    if (updateError) {
      console.error('POST private conversation read failed:', {
        conversationId,
        userId: accessRes.user.id,
        error: updateError,
      })
      return Response.json({ error: 'Failed to mark conversation as read' }, { status: 500 })
    }

    const { data: persisted, error: readError } = await admin
      .from('private_conversation_participants')
      .select('last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', accessRes.user.id)
      .maybeSingle()

    if (readError || !persisted?.last_read_at) {
      console.error('POST private conversation read result lookup failed:', {
        conversationId,
        userId: accessRes.user.id,
        error: readError,
      })
      return Response.json({ error: 'Failed to load conversation read state' }, { status: 500 })
    }

    return Response.json({ ok: true, lastReadAt: persisted.last_read_at })
  } catch (err) {
    console.error('POST private conversation read unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
