import { guardToResponse } from '@/app/api/_utils/auth'
import { requirePrivateConversationParticipant } from '@/app/api/_utils/private-chat'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

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

    const { error } = await admin
      .from('private_conversation_participants')
      .update({
        last_read_at: nowIso,
      })
      .eq('conversation_id', conversationId)
      .eq('user_id', accessRes.user.id)

    if (error) {
      console.error('POST private conversation read failed:', {
        conversationId,
        userId: accessRes.user.id,
        error,
      })
      return Response.json({ error: 'Failed to mark conversation as read' }, { status: 500 })
    }

    return Response.json({ ok: true, lastReadAt: nowIso })
  } catch (err) {
    console.error('POST private conversation read unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}