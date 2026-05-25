'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'

type UnreadSummaryResponse = {
  hasUnread?: boolean
  unreadConversationCount?: number
  error?: string
}

export function usePrivateChatUnread(enabled: boolean) {
  const { apiFetch, loading: authLoading, userId } = useAuth()

  const [hasUnread, setHasUnread] = useState(false)
  const [unreadConversationCount, setUnreadConversationCount] = useState(0)
  const active = enabled && !authLoading

  const refresh = useCallback(async () => {
    if (!enabled) return
    if (authLoading) return

    try {
      const res = await apiFetch('/api/private-conversations/unread', { method: 'GET' })
      const json = (await res.json().catch(() => null)) as UnreadSummaryResponse | null

      if (!res.ok) return

      const count = json?.unreadConversationCount ?? 0
      setUnreadConversationCount(count)
      setHasUnread(json?.hasUnread ?? count > 0)
    } catch {
      // Keep the previous state if the lightweight indicator refresh fails.
    }
  }, [apiFetch, authLoading, enabled])

  useEffect(() => {
    if (!active) return
    if (!userId) return

    const initialRefresh = window.setTimeout(() => {
      void refresh()
    }, 0)

    const interval = window.setInterval(() => {
      void refresh()
    }, 30000)

    const channel = supabase
      .channel(`private-chat-unread-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_messages',
        },
        () => {
          void refresh()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_conversation_participants',
        },
        () => {
          void refresh()
        }
      )
      .subscribe()

    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [active, refresh, userId])

  return {
    hasUnread: active ? hasUnread : false,
    unreadConversationCount: active ? unreadConversationCount : 0,
    refresh,
  }
}
