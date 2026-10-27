'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'
import { PRIVATE_CHAT_READ_EVENT } from '@/lib/chat-read-events'

type UnreadSummaryResponse = {
  hasUnread?: boolean
  unreadConversationCount?: number
  error?: string
}

export function usePrivateChatUnread(enabled: boolean) {
  const { apiFetch, loading: authLoading, token, userId } = useAuth()

  const [hasUnread, setHasUnread] = useState(false)
  const [unreadConversationCount, setUnreadConversationCount] = useState(0)
  const active = enabled && !authLoading && !!token && !!userId
  const activeRef = useRef(active)
  activeRef.current = active
  const previousUserIdRef = useRef(userId)

  const authIdentityRef = useRef({ apiFetch, enabled, authLoading, token, userId })
  const authGenerationRef = useRef(0)
  const effectGenerationRef = useRef(0)
  const activeEffectGenerationRef = useRef<number | null>(null)
  const inFlightRefreshRef = useRef<{
    authGeneration: number
    effectGeneration: number
    promise: Promise<void>
  } | null>(null)
  const refreshQueuedRef = useRef<{ authGeneration: number; effectGeneration: number } | null>(null)

  if (
    authIdentityRef.current.apiFetch !== apiFetch ||
    authIdentityRef.current.enabled !== enabled ||
    authIdentityRef.current.authLoading !== authLoading ||
    authIdentityRef.current.token !== token ||
    authIdentityRef.current.userId !== userId
  ) {
    authIdentityRef.current = { apiFetch, enabled, authLoading, token, userId }
    authGenerationRef.current += 1
    refreshQueuedRef.current = null
  }
  const authGeneration = authGenerationRef.current

  const refreshForGeneration = useCallback(async (expectedAuthGeneration: number, expectedEffectGeneration: number) => {
    const isCurrent = () => (
      activeRef.current &&
      authGenerationRef.current === expectedAuthGeneration &&
      activeEffectGenerationRef.current === expectedEffectGeneration
    )
    const canRefresh = () => isCurrent() && document.visibilityState === 'visible' && navigator.onLine
    if (!canRefresh()) return

    const inFlight = inFlightRefreshRef.current
    if (
      inFlight?.authGeneration === expectedAuthGeneration &&
      inFlight.effectGeneration === expectedEffectGeneration
    ) {
      refreshQueuedRef.current = { authGeneration: expectedAuthGeneration, effectGeneration: expectedEffectGeneration }
      await inFlight.promise
      return
    }

    const hasQueuedRefresh = () => {
      const queued = refreshQueuedRef.current
      return queued?.authGeneration === expectedAuthGeneration &&
        queued.effectGeneration === expectedEffectGeneration
    }
    const run = (async () => {
      do {
        refreshQueuedRef.current = null
        try {
          const res = await apiFetch('/api/private-conversations/unread', { method: 'GET' })
          const json = (await res.json().catch(() => null)) as UnreadSummaryResponse | null
          if (res.ok && isCurrent()) {
            const count = json?.unreadConversationCount ?? 0
            setUnreadConversationCount(count)
            setHasUnread(json?.hasUnread ?? count > 0)
          }
        } catch {
          // Keep the previous state if the lightweight indicator refresh fails.
        }
      } while (canRefresh() && hasQueuedRefresh())
    })()
    inFlightRefreshRef.current = {
      authGeneration: expectedAuthGeneration,
      effectGeneration: expectedEffectGeneration,
      promise: run,
    }

    try {
      await run
    } finally {
      if (inFlightRefreshRef.current?.promise === run) inFlightRefreshRef.current = null
    }
  }, [apiFetch])

  const refresh = useCallback(() => {
    const effectGeneration = activeEffectGenerationRef.current
    return effectGeneration === null
      ? Promise.resolve()
      : refreshForGeneration(authGeneration, effectGeneration)
  }, [authGeneration, refreshForGeneration])

  useEffect(() => {
    const userChanged = previousUserIdRef.current !== userId
    const loggedOut = !authLoading && (!token || !userId)
    if (userChanged || loggedOut || !enabled) {
      setHasUnread(false)
      setUnreadConversationCount(0)
    }
    previousUserIdRef.current = userId
  }, [authLoading, enabled, token, userId])

  useEffect(() => {
    if (!active) return
    if (!userId) return

    const effectGeneration = ++effectGenerationRef.current
    activeEffectGenerationRef.current = effectGeneration
    const refreshIfCurrent = () => {
      if (
        activeRef.current &&
        authGenerationRef.current === authGeneration &&
        activeEffectGenerationRef.current === effectGeneration &&
        document.visibilityState === 'visible' &&
        navigator.onLine
      ) {
        void refreshForGeneration(authGeneration, effectGeneration)
      }
    }

    let interval: number | null = null
    const stopPeriodicRefresh = () => {
      if (interval !== null) window.clearInterval(interval)
      interval = null
    }
    const startPeriodicRefresh = () => {
      stopPeriodicRefresh()
      if (document.visibilityState === 'visible' && navigator.onLine) {
        interval = window.setInterval(refreshIfCurrent, 30_000)
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startPeriodicRefresh()
        refreshIfCurrent()
      } else {
        refreshQueuedRef.current = null
        stopPeriodicRefresh()
      }
    }
    const onOnline = () => {
      startPeriodicRefresh()
      refreshIfCurrent()
    }
    const onOffline = () => {
      refreshQueuedRef.current = null
      stopPeriodicRefresh()
    }

    window.addEventListener('focus', refreshIfCurrent)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener(PRIVATE_CHAT_READ_EVENT, refreshIfCurrent)

    const channel = supabase
      .channel(`private-chat-unread-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_messages',
        },
        refreshIfCurrent
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_conversation_participants',
        },
        refreshIfCurrent
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refreshIfCurrent()
      })
    startPeriodicRefresh()
    refreshIfCurrent()

    return () => {
      stopPeriodicRefresh()
      window.removeEventListener('focus', refreshIfCurrent)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener(PRIVATE_CHAT_READ_EVENT, refreshIfCurrent)
      if (activeEffectGenerationRef.current === effectGeneration) {
        activeEffectGenerationRef.current = null
        refreshQueuedRef.current = null
        if (inFlightRefreshRef.current?.effectGeneration === effectGeneration) {
          inFlightRefreshRef.current = null
        }
      }
      supabase.removeChannel(channel)
    }
  }, [active, authGeneration, refreshForGeneration, userId])

  return {
    hasUnread: active ? hasUnread : false,
    unreadConversationCount: active ? unreadConversationCount : 0,
    refresh,
  }
}
