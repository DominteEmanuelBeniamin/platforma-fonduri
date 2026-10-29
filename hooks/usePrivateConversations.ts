'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'
import { userErrorMessage } from '@/lib/user-error'
import { chatTimestampMicroseconds } from '@/lib/chat-timestamp'

const compareChatTimestamps = (left: string, right: string) => {
  const leftTime = chatTimestampMicroseconds(left)
  const rightTime = chatTimestampMicroseconds(right)
  return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0
}

const maxIso = (left: string | null, right: string | null) => {
  if (!left) return right
  if (!right) return left
  return compareChatTimestamps(left, right) >= 0 ? left : right
}

export type PrivateConversationListItem = {
  id: string
  created_at: string
  created_by: string
  last_message_at: string | null
  last_read_at: string | null
  other_last_read_at: string | null
  has_unread?: boolean
  other_user: {
    id: string
    full_name: string | null
    email: string | null
  } | null
  last_message: {
    id: string
    body: string | null
    created_at: string
    created_by: string
  } | null
}

type GetPrivateConversationsResponse = {
  items: PrivateConversationListItem[]
}

type CreatePrivateConversationResponse = {
  item: {
    id: string
    created_at: string
    created_by: string
    last_message_at: string | null
  }
}

export function usePrivateConversations() {
  const { apiFetch, loading: authLoading, token, userId } = useAuth()
  const active = !authLoading && !!token && !!userId

  const [items, setItems] = useState<PrivateConversationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const activeRef = useRef(active)
  activeRef.current = active
  const authIdentityRef = useRef({ apiFetch, authLoading, token, userId })
  const authGenerationRef = useRef(0)
  const effectGenerationRef = useRef(0)
  const activeEffectGenerationRef = useRef<number | null>(null)
  const inFlightRefreshRef = useRef<{
    authGeneration: number
    effectGeneration: number
    promise: Promise<void>
  } | null>(null)
  const refreshQueuedRef = useRef<{ authGeneration: number; effectGeneration: number } | null>(null)
  const refreshTimeoutRef = useRef<number | null>(null)
  const hasLoadedRef = useRef(false)
  const loadedUserIdRef = useRef<string | null>(null)
  const errorSourceRef = useRef<'refresh' | 'action' | null>(null)

  if (
    authIdentityRef.current.apiFetch !== apiFetch ||
    authIdentityRef.current.authLoading !== authLoading ||
    authIdentityRef.current.token !== token ||
    authIdentityRef.current.userId !== userId
  ) {
    authIdentityRef.current = { apiFetch, authLoading, token, userId }
    authGenerationRef.current += 1
    refreshQueuedRef.current = null
  }
  const authGeneration = authGenerationRef.current

  const isCurrentRequest = useCallback((expectedAuthGeneration: number, expectedEffectGeneration: number) => (
    activeRef.current &&
    authGenerationRef.current === expectedAuthGeneration &&
    activeEffectGenerationRef.current === expectedEffectGeneration
  ), [])

  const refreshForGeneration = useCallback(async (expectedAuthGeneration: number, expectedEffectGeneration: number) => {
    const canRefresh = () => (
      isCurrentRequest(expectedAuthGeneration, expectedEffectGeneration) &&
      document.visibilityState === 'visible' && navigator.onLine
    )
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
        const isInitialLoad = !hasLoadedRef.current
        if (isInitialLoad) setLoading(true)

        try {
          const res = await apiFetch('/api/private-conversations', { method: 'GET' })
          const json = (await res.json().catch(() => null)) as GetPrivateConversationsResponse | null
          if (!isCurrentRequest(expectedAuthGeneration, expectedEffectGeneration)) break

          if (!res.ok) {
            errorSourceRef.current = 'refresh'
            setError(userErrorMessage(res.status, 'Nu am putut încărca conversațiile.'))
          } else {
            const nextItems = json?.items ?? []
            hasLoadedRef.current = true
            setItems(nextItems)
            setSelectedConversationId((current) => (
              current && nextItems.some((item) => item.id === current) ? current : null
            ))
            if (errorSourceRef.current === 'refresh') {
              errorSourceRef.current = null
              setError(null)
            }
          }
        } catch {
          if (isCurrentRequest(expectedAuthGeneration, expectedEffectGeneration)) {
            errorSourceRef.current = 'refresh'
            setError(userErrorMessage(undefined, 'Nu am putut încărca conversațiile.'))
          }
        } finally {
          if (isInitialLoad && isCurrentRequest(expectedAuthGeneration, expectedEffectGeneration)) {
            setLoading(false)
          }
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
  }, [apiFetch, isCurrentRequest])

  const refresh = useCallback(() => {
    const effectGeneration = activeEffectGenerationRef.current
    return effectGeneration === null
      ? Promise.resolve()
      : refreshForGeneration(authGeneration, effectGeneration)
  }, [authGeneration, refreshForGeneration])

  const openConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedConversationId(null)
  }, [])

  const openOrCreateConversation = useCallback(
    async (targetUserId: string) => {
      const effectGeneration = activeEffectGenerationRef.current
      if (!targetUserId || effectGeneration === null) return null
      if (!isCurrentRequest(authGeneration, effectGeneration)) return null

      setCreating(true)
      errorSourceRef.current = null
      setError(null)

      try {
        const existing = items.find((item) => item.other_user?.id === targetUserId)
        if (existing) {
          setSelectedConversationId(existing.id)
          return existing.id
        }

        const res = await apiFetch('/api/private-conversations', {
          method: 'POST',
          body: JSON.stringify({ userId: targetUserId }),
        })
        const json = (await res.json().catch(() => null)) as CreatePrivateConversationResponse | null
        if (!isCurrentRequest(authGeneration, effectGeneration)) return null

        if (!res.ok) {
          errorSourceRef.current = 'action'
          setError(userErrorMessage(res.status, 'Nu am putut crea conversația.'))
          return null
        }

        const createdId = json?.item?.id ?? null
        await refreshForGeneration(authGeneration, effectGeneration)
        if (createdId && isCurrentRequest(authGeneration, effectGeneration)) {
          setSelectedConversationId(createdId)
        }
        return createdId
      } catch {
        if (isCurrentRequest(authGeneration, effectGeneration)) {
          errorSourceRef.current = 'action'
          setError(userErrorMessage(undefined, 'Nu am putut crea conversația.'))
        }
        return null
      } finally {
        if (isCurrentRequest(authGeneration, effectGeneration)) setCreating(false)
      }
    },
    [apiFetch, authGeneration, isCurrentRequest, items, refreshForGeneration]
  )

  const selectedConversation = useMemo(
    () => items.find((item) => item.id === selectedConversationId) ?? null,
    [items, selectedConversationId]
  )

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items

    return items.filter((item) => {
      const name = item.other_user?.full_name?.toLowerCase() ?? ''
      const email = item.other_user?.email?.toLowerCase() ?? ''
      const body = item.last_message?.body?.toLowerCase() ?? ''
      return name.includes(q) || email.includes(q) || body.includes(q)
    })
  }, [items, search])

  const getIsUnread = useCallback((item: PrivateConversationListItem) => {
    if (typeof item.has_unread === 'boolean') return item.has_unread
    const lastMessage = item.last_message
    if (!lastMessage || !userId || lastMessage.created_by === userId) return false
    if (!item.last_read_at) return true
    return compareChatTimestamps(lastMessage.created_at, item.last_read_at) > 0
  }, [userId])

  const markConversationReadLocally = useCallback((conversationId: string, lastReadAt: string | null) => {
    if (!lastReadAt) return

    setItems((prev) => prev.map((item) => {
      if (item.id !== conversationId) return item
      const nextReadAt = maxIso(item.last_read_at, lastReadAt)
      const lastMessage = item.last_message
      const lastMessageCovered = !!lastMessage && !!nextReadAt &&
        compareChatTimestamps(lastMessage.created_at, nextReadAt) <= 0
      const hasUnread = lastMessageCovered
        ? false
        : lastMessage && userId && lastMessage.created_by !== userId
          ? true
          : item.has_unread ?? false
      return { ...item, last_read_at: nextReadAt, has_unread: hasUnread }
    }))
  }, [userId])

  useEffect(() => {
    if (!active || !userId) {
      if (!authLoading && !userId) {
        loadedUserIdRef.current = null
        hasLoadedRef.current = false
        setItems([])
        setSelectedConversationId(null)
        setLoading(false)
        setCreating(false)
        errorSourceRef.current = null
        setError(null)
      }
      return
    }

    const effectGeneration = ++effectGenerationRef.current
    activeEffectGenerationRef.current = effectGeneration
    setCreating(false)
    setLoading(!hasLoadedRef.current)
    if (loadedUserIdRef.current !== userId) {
      loadedUserIdRef.current = userId
      hasLoadedRef.current = false
      setItems([])
      setSelectedConversationId(null)
      setLoading(true)
      errorSourceRef.current = null
      setError(null)
    }

    const isCurrent = () => isCurrentRequest(authGeneration, effectGeneration)
    const refreshIfCurrent = () => {
      if (
        isCurrent() &&
        document.visibilityState === 'visible' &&
        navigator.onLine
      ) {
        void refreshForGeneration(authGeneration, effectGeneration)
      }
    }
    const scheduleRefresh = () => {
      if (!isCurrent()) return
      if (refreshTimeoutRef.current !== null) window.clearTimeout(refreshTimeoutRef.current)
      refreshTimeoutRef.current = window.setTimeout(() => {
        refreshTimeoutRef.current = null
        refreshIfCurrent()
      }, 150)
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

    const channel = supabase
      .channel(`private-conversations-list-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_messages' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_conversations' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_conversation_participants' }, scheduleRefresh)
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
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current)
        refreshTimeoutRef.current = null
      }
      if (activeEffectGenerationRef.current === effectGeneration) {
        activeEffectGenerationRef.current = null
        refreshQueuedRef.current = null
        if (inFlightRefreshRef.current?.effectGeneration === effectGeneration) {
          inFlightRefreshRef.current = null
        }
      }
      supabase.removeChannel(channel)
    }
  }, [active, authGeneration, authLoading, isCurrentRequest, refreshForGeneration, userId])

  return {
    items,
    filteredItems,
    loading,
    creating,
    error,
    search,
    setSearch,
    selectedConversationId,
    selectedConversation,
    openConversation,
    clearSelection,
    refresh,
    openOrCreateConversation,
    getIsUnread,
    markConversationReadLocally,
  }
}
