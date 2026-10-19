'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'
import { userErrorMessage } from '@/lib/user-error'
import { chatTimestampMicroseconds } from '@/lib/chat-timestamp'

export type PrivateChatProfile = {
  id: string
  full_name: string | null
  email: string | null
  is_active?: boolean | null
}

export type PrivateChatMessage = {
  id: string
  conversation_id: string
  created_by: string
  body: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  profiles: PrivateChatProfile | null
  is_deleted?: boolean
}

type GetMessagesResponse = {
  items: PrivateChatMessage[]
  nextCursor: string | null
}

type PostMessageResponse = {
  item: PrivateChatMessage
}

type PatchMessageResponse = {
  item: PrivateChatMessage
}

type DeleteMessageResponse = {
  ok: true
}

type ReadResponse = {
  ok: true
  lastReadAt: string
}

type ReadStateResponse = {
  ok: true
  lastReadAt: string | null
  otherLastReadAt: string | null
}

type UsePrivateChatOptions = {
  initialLimit?: number
  initialLastReadAt?: string | null
  initialOtherLastReadAt?: string | null
}

const compareChatTimestamps = (left: string, right: string) => {
  const leftTime = chatTimestampMicroseconds(left)
  const rightTime = chatTimestampMicroseconds(right)
  return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0
}

const maxIso = (a: string | null, b: string | null) => {
  if (!a) return b
  if (!b) return a
  return compareChatTimestamps(a, b) >= 0 ? a : b
}

const compareMessages = (a: PrivateChatMessage, b: PrivateChatMessage) => (
  compareChatTimestamps(a.created_at, b.created_at) || a.id.localeCompare(b.id)
)

const mergeMessage = (existing: PrivateChatMessage | undefined, incoming: PrivateChatMessage) => {
  if (!existing) return incoming

  const existingVersion = existing.edited_at ?? existing.created_at
  const incomingVersion = incoming.edited_at ?? incoming.created_at
  const message = compareChatTimestamps(incomingVersion, existingVersion) >= 0 ? incoming : existing
  const deletedAt = maxIso(existing.deleted_at, incoming.deleted_at)

  return {
    ...existing,
    ...message,
    profiles: incoming.profiles ?? existing.profiles,
    deleted_at: deletedAt,
    body: deletedAt ? null : message.body,
    is_deleted: deletedAt ? true : message.is_deleted,
  }
}

export function usePrivateChat(
  conversationId: string,
  opts: UsePrivateChatOptions = {}
) {
  const { apiFetch, loading: authLoading, token, userId } = useAuth()
  const initialLimit = opts.initialLimit ?? 50
  const active = !!conversationId && !authLoading && !!token && !!userId

  const [messages, setMessages] = useState<PrivateChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [lastReadAt, setLastReadAt] = useState<string | null>(opts.initialLastReadAt ?? null)
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(
    opts.initialOtherLastReadAt ?? null
  )

  const messagesRef = useRef<PrivateChatMessage[]>([])
  const hasLoadedRef = useRef(false)
  const loadedScopeRef = useRef<{ conversationId: string; userId: string } | null>(null)
  const initialLastReadAtRef = useRef(opts.initialLastReadAt ?? null)
  const initialOtherLastReadAtRef = useRef(opts.initialOtherLastReadAt ?? null)
  const activeRef = useRef(active)
  activeRef.current = active

  const identityRef = useRef({ apiFetch, authLoading, token, userId, conversationId })
  const authGenerationRef = useRef(0)
  const effectGenerationRef = useRef(0)
  const activeEffectGenerationRef = useRef<number | null>(null)
  const inFlightSyncRef = useRef<{
    authGeneration: number
    effectGeneration: number
    promise: Promise<void>
  } | null>(null)
  const syncQueuedRef = useRef<{
    authGeneration: number
    effectGeneration: number
    mode: 'recent' | 'full'
  } | null>(null)
  const readStateInFlightRef = useRef<{
    authGeneration: number
    effectGeneration: number
    promise: Promise<void>
  } | null>(null)
  const readStateQueuedRef = useRef<{ authGeneration: number; effectGeneration: number } | null>(null)
  const loadMoreInFlightRef = useRef<{ authGeneration: number; effectGeneration: number } | null>(null)

  if (
    identityRef.current.apiFetch !== apiFetch ||
    identityRef.current.authLoading !== authLoading ||
    identityRef.current.token !== token ||
    identityRef.current.userId !== userId ||
    identityRef.current.conversationId !== conversationId
  ) {
    identityRef.current = { apiFetch, authLoading, token, userId, conversationId }
    authGenerationRef.current += 1
    syncQueuedRef.current = null
    readStateQueuedRef.current = null
  }
  const authGeneration = authGenerationRef.current

  const isCurrentRequest = useCallback((expectedAuthGeneration: number, expectedEffectGeneration: number) => (
    activeRef.current &&
    authGenerationRef.current === expectedAuthGeneration &&
    activeEffectGenerationRef.current === expectedEffectGeneration
  ), [])

  const replaceMessages = useCallback((nextMessages: PrivateChatMessage[]) => {
    messagesRef.current = nextMessages
    setMessages(nextMessages)
  }, [])

  const applyIncomingMessages = useCallback((
    incomingMessages: PrivateChatMessage[],
    minimumNewMessage: PrivateChatMessage | null = null
  ) => {
    const byId = new Map<string, PrivateChatMessage>(
      messagesRef.current.map((message): [string, PrivateChatMessage] => [message.id, message])
    )
    for (const incoming of incomingMessages) {
      const existing = byId.get(incoming.id)
      if (!existing && minimumNewMessage && compareMessages(incoming, minimumNewMessage) < 0) continue
      byId.set(incoming.id, mergeMessage(existing, incoming))
    }
    replaceMessages(Array.from(byId.values()).sort(compareMessages))
  }, [replaceMessages])

  const resetState = useCallback((lastRead: string | null, otherLastRead: string | null) => {
    messagesRef.current = []
    hasLoadedRef.current = false
    setMessages([])
    setNextCursor(null)
    setError(null)
    setLoading(false)
    setSending(false)
    setLastReadAt(lastRead)
    setOtherLastReadAt(otherLastRead)
  }, [])

  const pushOne = useCallback((m: PrivateChatMessage) => {
    applyIncomingMessages([m])
  }, [applyIncomingMessages])

  const upsertOne = useCallback((m: PrivateChatMessage) => {
    applyIncomingMessages([m])
  }, [applyIncomingMessages])

  const readStateForGeneration = useCallback(async (
    expectedAuthGeneration: number,
    expectedEffectGeneration: number
  ) => {
    const canRefresh = () => (
      isCurrentRequest(expectedAuthGeneration, expectedEffectGeneration) &&
      document.visibilityState === 'visible' && navigator.onLine
    )
    if (!canRefresh()) return

    const inFlight = readStateInFlightRef.current
    if (
      inFlight?.authGeneration === expectedAuthGeneration &&
      inFlight.effectGeneration === expectedEffectGeneration
    ) {
      readStateQueuedRef.current = {
        authGeneration: expectedAuthGeneration,
        effectGeneration: expectedEffectGeneration,
      }
      await inFlight.promise
      return
    }

    const hasQueuedReadState = () => {
      const queued = readStateQueuedRef.current
      return queued?.authGeneration === expectedAuthGeneration &&
        queued.effectGeneration === expectedEffectGeneration
    }
    const run = (async () => {
      do {
        readStateQueuedRef.current = null
        try {
          const res = await apiFetch(`/api/private-conversations/${conversationId}/read`, {
            method: 'GET',
          })
          const json = (await res.json().catch(() => null)) as ReadStateResponse | null
          if (res.ok && json?.ok && canRefresh()) {
            setLastReadAt((prev) => maxIso(prev, json.lastReadAt))
            setOtherLastReadAt((prev) => maxIso(prev, json.otherLastReadAt))
          }
        } catch {
          // Retain the last good frontiers after a temporary GET failure.
        }
      } while (canRefresh() && hasQueuedReadState())
    })()
    readStateInFlightRef.current = {
      authGeneration: expectedAuthGeneration,
      effectGeneration: expectedEffectGeneration,
      promise: run,
    }

    try {
      await run
    } finally {
      if (readStateInFlightRef.current?.promise === run) readStateInFlightRef.current = null
    }
  }, [apiFetch, conversationId, isCurrentRequest])

  const getCurrentOperation = useCallback(() => {
    const effectGeneration = activeEffectGenerationRef.current
    return effectGeneration !== null && isCurrentRequest(authGeneration, effectGeneration)
      ? { authGeneration, effectGeneration }
      : null
  }, [authGeneration, isCurrentRequest])

  const loadMore = useCallback(async () => {
    const operation = getCurrentOperation()
    if (!operation || !nextCursor || loading) return
    const existingLoad = loadMoreInFlightRef.current
    if (
      existingLoad?.authGeneration === operation.authGeneration &&
      existingLoad.effectGeneration === operation.effectGeneration
    ) return

    const requestedCursor = nextCursor
    loadMoreInFlightRef.current = operation
    setLoading(true)
    setError(null)

    try {
      const res = await apiFetch(
        `/api/private-conversations/${conversationId}/messages?limit=${initialLimit}&cursor=${encodeURIComponent(requestedCursor)}`,
        { method: 'GET' }
      )
      const json = (await res.json().catch(() => null)) as GetMessagesResponse | null
      if (!isCurrentRequest(operation.authGeneration, operation.effectGeneration)) return

      if (!res.ok) {
        setError(userErrorMessage(res.status, 'Nu am putut încărca mesajele mai vechi.'))
        return
      }

      applyIncomingMessages((json?.items ?? []).slice().reverse())
      setNextCursor(json?.nextCursor ?? null)
    } catch {
      if (isCurrentRequest(operation.authGeneration, operation.effectGeneration)) {
        setError(userErrorMessage(undefined, 'Nu am putut încărca mesajele mai vechi.'))
      }
    } finally {
      if (isCurrentRequest(operation.authGeneration, operation.effectGeneration)) setLoading(false)
      if (
        loadMoreInFlightRef.current?.authGeneration === operation.authGeneration &&
        loadMoreInFlightRef.current.effectGeneration === operation.effectGeneration
      ) loadMoreInFlightRef.current = null
    }
  }, [apiFetch, applyIncomingMessages, conversationId, getCurrentOperation, initialLimit, isCurrentRequest, loading, nextCursor])

  const sendMessage = useCallback(
    async (body: string) => {
      const operation = getCurrentOperation()
      if (!operation) return
      const trimmed = body.trim()
      if (!trimmed) return

      setSending(true)
      setError(null)

      try {
        const res = await apiFetch(`/api/private-conversations/${conversationId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body: trimmed }),
        })
        const json = (await res.json().catch(() => null)) as PostMessageResponse | null
        if (!isCurrentRequest(operation.authGeneration, operation.effectGeneration)) return

        if (!res.ok) {
          setError(userErrorMessage(res.status, 'Nu am putut trimite mesajul.'))
          return
        }

        const item = json?.item
        if (item) pushOne(item)
      } catch {
        if (isCurrentRequest(operation.authGeneration, operation.effectGeneration)) {
          setError(userErrorMessage(undefined, 'Nu am putut trimite mesajul.'))
        }
      } finally {
        if (isCurrentRequest(operation.authGeneration, operation.effectGeneration)) setSending(false)
      }
    },
    [apiFetch, conversationId, getCurrentOperation, isCurrentRequest, pushOne]
  )

  const editMessage = useCallback(
    async (messageId: string, body: string) => {
      const operation = getCurrentOperation()
      if (!operation) return
      const trimmed = body.trim()
      if (!trimmed) return

      setError(null)

      try {
        const res = await apiFetch(
          `/api/private-conversations/${conversationId}/messages/${messageId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ body: trimmed }),
          }
        )
        const json = (await res.json().catch(() => null)) as PatchMessageResponse | null
        if (!isCurrentRequest(operation.authGeneration, operation.effectGeneration)) return

        if (!res.ok) {
          setError(userErrorMessage(res.status, 'Nu am putut edita mesajul.'))
          return
        }

        if (json?.item) upsertOne(json.item)
      } catch {
        if (isCurrentRequest(operation.authGeneration, operation.effectGeneration)) {
          setError(userErrorMessage(undefined, 'Nu am putut edita mesajul.'))
        }
      }
    },
    [apiFetch, conversationId, getCurrentOperation, isCurrentRequest, upsertOne]
  )

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const operation = getCurrentOperation()
      if (!operation) return
      setError(null)

      try {
        const res = await apiFetch(
          `/api/private-conversations/${conversationId}/messages/${messageId}`,
          {
            method: 'DELETE',
          }
        )
        const json = (await res.json().catch(() => null)) as DeleteMessageResponse | null
        if (!isCurrentRequest(operation.authGeneration, operation.effectGeneration)) return

        if (!res.ok || !json?.ok) {
          setError(userErrorMessage(res.status, 'Nu am putut șterge mesajul.'))
          return
        }

        const nowIso = new Date().toISOString()
        const existing = messagesRef.current.find((message) => message.id === messageId)
        if (existing) upsertOne({ ...existing, body: null, deleted_at: nowIso, is_deleted: true })
      } catch {
        if (isCurrentRequest(operation.authGeneration, operation.effectGeneration)) {
          setError(userErrorMessage(undefined, 'Nu am putut șterge mesajul.'))
        }
      }
    },
    [apiFetch, conversationId, getCurrentOperation, isCurrentRequest, upsertOne]
  )

  const markAsRead = useCallback(async (readThroughAt?: string | null) => {
    const operation = getCurrentOperation()
    if (!operation) return

    try {
      const res = await apiFetch(`/api/private-conversations/${conversationId}/read`, {
        method: 'POST',
        body: JSON.stringify({ readThroughAt: readThroughAt ?? undefined }),
      })
      const json = (await res.json().catch(() => null)) as ReadResponse | null
      if (!isCurrentRequest(operation.authGeneration, operation.effectGeneration)) return

      if (!res.ok || !json?.ok || !json.lastReadAt) return
      setLastReadAt((prev) => maxIso(prev, json.lastReadAt))
    } catch {
      // silent fail
    }
  }, [apiFetch, conversationId, getCurrentOperation, isCurrentRequest])

  const hasPendingOutgoingReadReceipt = useMemo(() => {
    if (!userId) return false

    return messages.some((m) => {
      if (m.deleted_at) return false
      if (m.created_by !== userId) return false
      if (!otherLastReadAt) return true
      return compareChatTimestamps(m.created_at, otherLastReadAt) > 0
    })
  }, [messages, otherLastReadAt, userId])

  const unreadCount = useMemo(() => {
    if (!lastReadAt) {
      return messages.filter((m) => !m.deleted_at && m.created_by !== userId).length
    }

    return messages.filter(
      (m) =>
        !m.deleted_at &&
        m.created_by !== userId &&
        compareChatTimestamps(m.created_at, lastReadAt) > 0
    ).length
  }, [lastReadAt, messages, userId])

  useEffect(() => {
    if (!active || !token || !userId || !conversationId) {
      if (!authLoading && (!token || !userId || !conversationId)) {
        loadedScopeRef.current = null
        hasLoadedRef.current = false
        resetState(null, null)
      }
      return
    }

    const effectGeneration = ++effectGenerationRef.current
    activeEffectGenerationRef.current = effectGeneration
    const loadedScope = loadedScopeRef.current
    if (
      !loadedScope ||
      loadedScope.conversationId !== conversationId ||
      loadedScope.userId !== userId
    ) {
      loadedScopeRef.current = { conversationId, userId }
      initialLastReadAtRef.current = opts.initialLastReadAt ?? null
      initialOtherLastReadAtRef.current = opts.initialOtherLastReadAt ?? null
      resetState(initialLastReadAtRef.current, initialOtherLastReadAtRef.current)
    }
    setSending(false)
    setLoading(!hasLoadedRef.current)

    const isCurrent = () => isCurrentRequest(authGeneration, effectGeneration)
    const canSync = () => isCurrent() && document.visibilityState === 'visible' && navigator.onLine

    const fetchMessages = async (mode: 'recent' | 'full') => {
      if (!canSync()) return false

      const existingMessages = messagesRef.current
      const boundary = mode === 'full'
        ? existingMessages[0] ?? null
        : existingMessages[existingMessages.length - 1] ?? null
      const collected: PrivateChatMessage[] = []
      const seenCursors = new Set<string>()
      let cursor: string | null = null
      let firstPage = true
      let firstPageCursor: string | null = null

      while (true) {
        if (!canSync()) return false
        const query = cursor
          ? `?limit=${initialLimit}&cursor=${encodeURIComponent(cursor)}`
          : `?limit=${initialLimit}`
        const res = await apiFetch(
          `/api/private-conversations/${conversationId}/messages${query}`,
          { method: 'GET' }
        )
        const json = (await res.json().catch(() => null)) as GetMessagesResponse | null
        if (!canSync()) return false
        if (!res.ok) throw new Error('messages-refresh-failed')

        const pageItems = json?.items ?? []
        collected.push(...pageItems)
        const pageCursor = json?.nextCursor ?? null
        if (firstPage) {
          firstPageCursor = pageCursor
          firstPage = false
        }

        if (boundary && pageItems.some((message) => message.id === boundary.id)) break
        if (!pageCursor || seenCursors.has(pageCursor) || !boundary) break
        seenCursors.add(pageCursor)
        cursor = pageCursor
      }

      if (!canSync()) return false
      const minimumNewMessage = boundary
        ? (mode === 'full' ? existingMessages[0] : existingMessages[existingMessages.length - 1]) ?? null
        : null
      // Publish only after every page up to the loaded boundary has succeeded.
      applyIncomingMessages(collected, minimumNewMessage)
      if (!hasLoadedRef.current) {
        hasLoadedRef.current = true
        setNextCursor(firstPageCursor)
      }
      return true
    }

    const requestSync = (requestedMode: 'recent' | 'full') => {
      if (!canSync()) return Promise.resolve()
      const inFlight = inFlightSyncRef.current
      if (
        inFlight?.authGeneration === authGeneration &&
        inFlight.effectGeneration === effectGeneration
      ) {
        const queued = syncQueuedRef.current
        syncQueuedRef.current = {
          authGeneration,
          effectGeneration,
          mode: requestedMode === 'full' || queued?.mode === 'full' ? 'full' : 'recent',
        }
        return inFlight.promise
      }

      const getQueuedSyncMode = () => {
        const queued = syncQueuedRef.current
        return queued?.authGeneration === authGeneration && queued.effectGeneration === effectGeneration
          ? queued.mode
          : null
      }
      const hasQueuedSync = () => getQueuedSyncMode() !== null
      const run = (async () => {
        let mode = requestedMode
        do {
          syncQueuedRef.current = null
          if (!canSync()) break
          const isInitialLoad = !hasLoadedRef.current
          if (isInitialLoad) setLoading(true)
          try {
            const succeeded = await fetchMessages(mode)
            if (succeeded && isCurrent() && isInitialLoad) setError(null)
          } catch {
            if (isCurrent() && !hasLoadedRef.current) {
              setError(userErrorMessage(undefined, 'Nu am putut încărca mesajele.'))
            }
          } finally {
            if (isInitialLoad && isCurrent()) setLoading(false)
          }

          await readStateForGeneration(authGeneration, effectGeneration)
          const queuedMode = getQueuedSyncMode()
          if (queuedMode) mode = queuedMode
        } while (canSync() && hasQueuedSync())
      })()
      inFlightSyncRef.current = { authGeneration, effectGeneration, promise: run }
      return run.finally(() => {
        if (inFlightSyncRef.current?.promise === run) inFlightSyncRef.current = null
      })
    }

    const onMessageChange = (payload: { new: unknown }) => {
      if (!isCurrent()) return
      const row = payload.new as Partial<PrivateChatMessage> & { id?: string }
      if (!row?.id) return
      const existing = messagesRef.current.find((message) => message.id === row.id)
      if (existing) {
        const incoming = { ...existing, ...row, profiles: existing.profiles } as PrivateChatMessage
        upsertOne(incoming)
      }
      void requestSync('full')
    }

    const onParticipantChange = (payload: { new: unknown }) => {
      if (!isCurrent()) return
      const row = payload.new as { user_id?: string; last_read_at?: string | null } | null
      if (!row?.user_id) return
      if (row.user_id === userId) {
        setLastReadAt((previous) => maxIso(previous, row.last_read_at ?? null))
      } else {
        setOtherLastReadAt((previous) => maxIso(previous, row.last_read_at ?? null))
      }
    }

    let interval: number | null = null
    const stopPeriodicRefresh = () => {
      if (interval !== null) window.clearInterval(interval)
      interval = null
    }
    const refreshIfCurrent = () => {
      if (canSync()) void requestSync('full')
    }
    const startPeriodicRefresh = () => {
      stopPeriodicRefresh()
      if (document.visibilityState === 'visible' && navigator.onLine) {
        interval = window.setInterval(() => {
          if (canSync()) void requestSync('full')
        }, 30_000)
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startPeriodicRefresh()
        refreshIfCurrent()
      } else {
        syncQueuedRef.current = null
        readStateQueuedRef.current = null
        stopPeriodicRefresh()
      }
    }
    const onOnline = () => {
      startPeriodicRefresh()
      refreshIfCurrent()
    }
    const onOffline = () => {
      syncQueuedRef.current = null
      readStateQueuedRef.current = null
      stopPeriodicRefresh()
    }

    window.addEventListener('focus', refreshIfCurrent)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    const channel = supabase
      .channel(`private-chat-${conversationId}-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        onMessageChange
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'private_conversation_participants',
          filter: `conversation_id=eq.${conversationId}`,
        },
        onParticipantChange
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
      if (activeEffectGenerationRef.current === effectGeneration) {
        activeEffectGenerationRef.current = null
        syncQueuedRef.current = null
        readStateQueuedRef.current = null
        if (inFlightSyncRef.current?.effectGeneration === effectGeneration) inFlightSyncRef.current = null
        if (readStateInFlightRef.current?.effectGeneration === effectGeneration) readStateInFlightRef.current = null
        if (loadMoreInFlightRef.current?.effectGeneration === effectGeneration) loadMoreInFlightRef.current = null
      }
      supabase.removeChannel(channel)
    }
  }, [
    active,
    apiFetch,
    authGeneration,
    authLoading,
    applyIncomingMessages,
    conversationId,
    initialLimit,
    isCurrentRequest,
    opts.initialLastReadAt,
    opts.initialOtherLastReadAt,
    readStateForGeneration,
    resetState,
    token,
    upsertOne,
    userId,
  ])

  useEffect(() => {
    if (!active || !conversationId || !hasPendingOutgoingReadReceipt) return
    const effectGeneration = activeEffectGenerationRef.current
    if (effectGeneration === null) return

    let interval: number | null = null
    const stop = () => {
      if (interval !== null) window.clearInterval(interval)
      interval = null
    }
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void readStateForGeneration(authGeneration, effectGeneration)
      }
    }
    const start = () => {
      stop()
      if (document.visibilityState === 'visible' && navigator.onLine) {
        interval = window.setInterval(refreshIfVisible, 2000)
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        start()
        refreshIfVisible()
      } else {
        stop()
      }
    }
    const onOnline = () => {
      start()
      refreshIfVisible()
    }
    const onOffline = stop

    start()
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      stop()
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [active, authGeneration, conversationId, hasPendingOutgoingReadReceipt, readStateForGeneration])

  const hasMore = useMemo(() => !!nextCursor, [nextCursor])

  return {
    messages,
    loading,
    sending,
    error,
    hasMore,
    loadMore,
    sendMessage,
    editMessage,
    deleteMessage,
    setError,
    unreadCount,
    markAsRead,
    lastReadAt,
    otherLastReadAt,
  }
}
