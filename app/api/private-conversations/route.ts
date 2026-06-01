import { z } from 'zod'
import { guardToResponse } from '@/app/api/_utils/auth'
import { getOrCreatePrivateConversation, listPrivateConversationsForCurrentUser } from '@/app/api/_utils/private-chat'
import { logAction } from '@/app/api/_utils/audit'

const CreateConversationSchema = z.object({
  userId: z.string().uuid(),
})

export async function POST(request: Request) {
  try {
    const bodyJson = await request.json().catch(() => null)
    const parsed = CreateConversationSchema.safeParse(bodyJson)

    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: z.treeifyError(parsed.error) },
        { status: 400 }
      )
    }

    const result = await getOrCreatePrivateConversation(request, parsed.data.userId)
    if (!result.ok) return guardToResponse(result)

    if (result.conversation && result.conversation.created_by === result.user.id) {
      await logAction({
        actorId: result.user.id,
        actionType: 'create',
        entityType: 'private_conversation',
        entityId: result.conversation.id,
        entityName: `conv:${result.conversation.id}`,
        newValues: {
          conversation_id: result.conversation.id,
          target_user_id: parsed.data.userId,
        },
        description: `Creare conversatie privata cu ${parsed.data.userId}`,
        request,
      })
    }

    return Response.json({ item: result.conversation }, { status: 200 })
  } catch (err) {
    console.error('POST private conversation unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const result = await listPrivateConversationsForCurrentUser(request)
    if (!result.ok) return guardToResponse(result)

    return Response.json({ items: result.items })
  } catch (err) {
    console.error('GET private conversations unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
