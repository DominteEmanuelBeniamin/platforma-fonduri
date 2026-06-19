import { guardToResponse } from '@/app/api/_utils/auth'
import { getProjectChatUnreadSummary } from '@/app/api/_utils/project-chat'

export async function GET(request: Request) {
  try {
    const result = await getProjectChatUnreadSummary(request)
    if (!result.ok) return guardToResponse(result)

    return Response.json({
      hasUnread: result.hasUnread,
      unreadProjectCount: result.unreadProjectCount,
      unreadMessageCount: result.unreadMessageCount,
      unreadProjects: result.unreadProjects,
    })
  } catch (err) {
    console.error('GET project chat unread summary unexpected error:', err)
    return Response.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
