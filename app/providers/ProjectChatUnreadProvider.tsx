'use client'

import { createUnreadSummaryProvider } from '@/app/providers/createUnreadSummaryProvider'
import { PROJECT_CHAT_READ_EVENT } from '@/lib/chat-read-events'

export type ProjectChatUnreadProject = {
  projectId: string
  unreadMessageCount: number
}

type ProjectChatUnreadState = {
  hasUnread: boolean
  unreadProjectCount: number
  unreadMessageCount: number
  unreadProjects: ProjectChatUnreadProject[]
}

type UnreadSummaryResponse = {
  hasUnread?: boolean
  unreadProjectCount?: number
  unreadMessageCount?: number
  unreadProjects?: ProjectChatUnreadProject[]
}

const { Provider, useSummary } = createUnreadSummaryProvider<ProjectChatUnreadState>({
  name: 'useProjectChatUnread',
  endpoint: '/api/projects/chat/unread',
  emptyState: {
    hasUnread: false,
    unreadProjectCount: 0,
    unreadMessageCount: 0,
    unreadProjects: [],
  },
  parse: (payload) => {
    const json = payload as UnreadSummaryResponse | null
    const projectCount = json?.unreadProjectCount ?? 0
    return {
      hasUnread: json?.hasUnread ?? projectCount > 0,
      unreadProjectCount: projectCount,
      unreadMessageCount: json?.unreadMessageCount ?? 0,
      unreadProjects: json?.unreadProjects ?? [],
    }
  },
  channelName: (userId) => `project-chat-unread-global-${userId}`,
  sources: [
    { table: 'project_chat_events' },
    { table: 'project_chat_reads' },
  ],
  refreshOnWindowFocus: true,
  refreshEvent: PROJECT_CHAT_READ_EVENT,
})

export const ProjectChatUnreadProvider = Provider
export const useProjectChatUnread = useSummary
