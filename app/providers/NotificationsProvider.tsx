'use client'

import { createUnreadSummaryProvider } from '@/app/providers/createUnreadSummaryProvider'

export type NotificationUnreadByProject = {
  projectId: string
  count: number
}

type NotificationsState = {
  unreadCount: number
  unreadByProject: NotificationUnreadByProject[]
}

type NotificationSummaryResponse = {
  unreadCount?: number
  unreadByProject?: NotificationUnreadByProject[]
}

const { Provider, useSummary } = createUnreadSummaryProvider<NotificationsState>({
  name: 'useNotifications',
  endpoint: '/api/notifications/summary',
  emptyState: { unreadCount: 0, unreadByProject: [] },
  parse: (payload) => {
    const json = payload as NotificationSummaryResponse | null
    return {
      unreadCount: json?.unreadCount ?? 0,
      unreadByProject: json?.unreadByProject ?? [],
    }
  },
  channelName: (userId) => `notifications-unread-${userId}`,
  sources: [{ table: 'notifications', filter: (userId) => `user_id=eq.${userId}` }],
  // Clopoțelul se deschide peste pagină: contorul trebuie să fie proaspăt la
  // revenirea în tab, nu doar când sosește un eveniment realtime.
  refreshOnWindowFocus: true,
})

export const NotificationsProvider = Provider
export const useNotifications = useSummary
