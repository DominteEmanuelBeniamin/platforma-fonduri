import { guardToResponse } from '@/app/api/_utils/auth'
import { getPrivateConversationUnreadSummary } from '@/app/api/_utils/private-chat'

export async function GET(request: Request) {
  try {
    const result = await getPrivateConversationUnreadSummary(request)
    if (!result.ok) return guardToResponse(result)

    return Response.json({
      hasUnread: result.hasUnread,
      unreadConversationCount: result.unreadConversationCount,
    })
  } catch (err) {
    console.error('GET private conversation unread summary unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
