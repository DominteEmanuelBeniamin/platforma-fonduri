'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'

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

type NotificationsContextValue = NotificationsState & {
  active: boolean
  refresh: () => Promise<void>
}

const emptyState: NotificationsState = {
  unreadCount: 0,
  unreadByProject: [],
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { apiFetch, loading: authLoading, token, userId } = useAuth()
  const active = !authLoading && !!token && !!userId
  const [state, setState] = useState<NotificationsState>(emptyState)
  const inFlightRefreshRef = useRef<Promise<void> | null>(null)
  const refreshQueuedRef = useRef(false)
  const generationRef = useRef(0)
  const activeRef = useRef(active)
  if (activeRef.current !== active) {
    activeRef.current = active
    generationRef.current += 1
  }

  const refresh = useCallback(async () => {
    if (!activeRef.current) return

    const inFlight = inFlightRefreshRef.current
    if (inFlight) {
      refreshQueuedRef.current = true
      await inFlight
      if (refreshQueuedRef.current && activeRef.current) {
        refreshQueuedRef.current = false
        await refresh()
      }
      return
    }

    const generation = generationRef.current
    inFlightRefreshRef.current = (async () => {
      try {
        const res = await apiFetch('/api/notifications/summary', { method: 'GET' })
        const json = (await res.json().catch(() => null)) as NotificationSummaryResponse | null
        if (!res.ok || generation !== generationRef.current || !activeRef.current) return

        setState({
          unreadCount: json?.unreadCount ?? 0,
          unreadByProject: json?.unreadByProject ?? [],
        })
      } catch {
        // Păstrăm ultima stare pentru un indicator care nu trebuie să blocheze UI-ul.
      } finally {
        if (generation === generationRef.current) inFlightRefreshRef.current = null
      }
    })()

    await inFlightRefreshRef.current
  }, [apiFetch])

  useEffect(() => {
    if (active) return
    inFlightRefreshRef.current = null
    refreshQueuedRef.current = false
    setState(emptyState)
  }, [active])

  useEffect(() => {
    if (!active || !userId) return

    void refresh()

    const onFocus = () => { void refresh() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    const channel = supabase
      .channel(`notifications-unread-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refresh()
        },
      )
      .subscribe()

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      supabase.removeChannel(channel)
    }
  }, [active, refresh, userId])

  const value = useMemo<NotificationsContextValue>(
    () => ({ active, refresh, ...state }),
    [active, refresh, state],
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications(enabled = true) {
  const value = useContext(NotificationsContext)
  if (!value) throw new Error('useNotifications must be used within NotificationsProvider')

  const active = enabled && value.active

  return {
    unreadCount: active ? value.unreadCount : 0,
    unreadByProject: active ? value.unreadByProject : [],
    refresh: value.refresh,
  }
}
