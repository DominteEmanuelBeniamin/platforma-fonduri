/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'

export type PrivateChatProfile = {
  id: string
  full_name: string | null
  email: string | null
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

type GetMessageByIdResponse = {
  item: PrivateChatMessage
}

type ReadResponse = {
  ok: true
  lastReadAt: string
}

type UsePrivateChatOptions = {
  initialLimit?: number
  initialLastReadAt?: string | null
}

export function usePrivateChat(
  conversationId: string,
  opts: UsePrivateChatOptions = {}
) {
  const { apiFetch, loading: authLoading, userId } = useAuth()
  const initialLimit = opts.initialLimit ?? 50


  const [messages, setMessages] = useState<PrivateChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [lastReadAt, setLastReadAt] = useState<string | null>(opts.initialLastReadAt ?? null)

  const idsRef = useRef<Set<string>>(new Set())

  const resetState = useCallback(() => {
    idsRef.current = new Set()
    setMessages([])
    setNextCursor(null)
    setError(null)
    setLoading(false)
    setSending(false)
    setLastReadAt(opts.initialLastReadAt ?? null)
  }, [opts.initialLastReadAt])

  const pushOne = useCallback((m: PrivateChatMessage) => {
    if (idsRef.current.has(m.id)) return
    idsRef.current.add(m.id)

    setMessages((prev) => {
      const next = prev.concat(m)
      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      return next
    })
  }, [])

  const upsertOne = useCallback((m: PrivateChatMessage) => {
    idsRef.current.add(m.id)

    setMessages((prev) => {
      const existing = prev.find((x) => x.id === m.id)

      const merged: PrivateChatMessage = existing
        ? { ...existing, ...m, profiles: m.profiles ?? existing.profiles }
        : m

      const next = existing
        ? prev.map((x) => (x.id === m.id ? merged : x))
        : prev.concat(merged)

      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      return next
    })
  }, [])

  const fetchInitial = useCallback(async () => {
    if (!conversationId) return
    if (authLoading) return

    setLoading(true)
    setError(null)

    try {
      const res = await apiFetch(
        `/api/private-conversations/${conversationId}/messages?limit=${initialLimit}`,
        { method: 'GET' }
      )
      const json = (await res.json().catch(() => null)) as GetMessagesResponse | null

      if (!res.ok) {
        setError((json as any)?.error ?? 'Failed to load messages')
        resetState()
        return
      }

      const apiItems = json?.items ?? []
      const cursor = json?.nextCursor ?? null

      const oldestFirst = apiItems.slice().reverse()

      idsRef.current = new Set(oldestFirst.map((m) => m.id))
      setMessages(oldestFirst)
      setNextCursor(cursor)
    } catch {
      setError('Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, authLoading, conversationId, initialLimit, resetState])

  const loadMore = useCallback(async () => {
    if (!conversationId) return
    if (authLoading) return
    if (!nextCursor) return
    if (loading) return

    setLoading(true)
    setError(null)

    try {
      const url = `/api/private-conversations/${conversationId}/messages?limit=${initialLimit}&cursor=${encodeURIComponent(
        nextCursor
      )}`

      const res = await apiFetch(url, { method: 'GET' })
      const json = (await res.json().catch(() => null)) as GetMessagesResponse | null

      if (!res.ok) {
        setError((json as any)?.error ?? 'Failed to load more messages')
        return
      }

      const apiItems = json?.items ?? []
      const cursor = json?.nextCursor ?? null
      const oldestFirst = apiItems.slice().reverse()

      setMessages((prev) => {
        const merged = [...oldestFirst, ...prev]
        const seen = new Set<string>()
        const out: PrivateChatMessage[] = []

        for (const m of merged) {
          if (seen.has(m.id)) continue
          seen.add(m.id)
          out.push(m)
        }

        idsRef.current = new Set(out.map((m) => m.id))
        out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        return out
      })

      setNextCursor(cursor)
    } catch {
      setError('Failed to load more messages')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, authLoading, conversationId, initialLimit, loading, nextCursor])

  const sendMessage = useCallback(
    async (body: string) => {
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

        if (!res.ok) {
          setError((json as any)?.error ?? 'Failed to send message')
          return
        }

        const item = json?.item
        if (item) pushOne(item)
      } catch {
        setError('Failed to send message')
      } finally {
        setSending(false)
      }
    },
    [apiFetch, conversationId, pushOne]
  )

  const editMessage = useCallback(
    async (messageId: string, body: string) => {
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

        if (!res.ok) {
          setError((json as any)?.error ?? 'Failed to edit message')
          return
        }

        if (json?.item) upsertOne(json.item)
      } catch {
        setError('Failed to edit message')
      }
    },
    [apiFetch, conversationId, upsertOne]
  )

  const deleteMessage = useCallback(
    async (messageId: string) => {
      setError(null)

      try {
        const res = await apiFetch(
          `/api/private-conversations/${conversationId}/messages/${messageId}`,
          {
            method: 'DELETE',
          }
        )
        const json = (await res.json().catch(() => null)) as DeleteMessageResponse | null

        if (!res.ok || !json?.ok) {
          setError((json as any)?.error ?? 'Failed to delete message')
          return
        }

        const nowIso = new Date().toISOString()
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, deleted_at: nowIso } : m))
        )
      } catch {
        setError('Failed to delete message')
      }
    },
    [apiFetch, conversationId]
  )

  const markAsRead = useCallback(async () => {
    if (!conversationId) return
    if (authLoading) return

    try {
      const res = await apiFetch(`/api/private-conversations/${conversationId}/read`, {
        method: 'POST',
      })
      const json = (await res.json().catch(() => null)) as ReadResponse | null

      if (!res.ok || !json?.ok || !json.lastReadAt) return
      setLastReadAt(json.lastReadAt)
    } catch {
      // silent fail
    }
  }, [apiFetch, authLoading, conversationId])

  const unreadCount = useMemo(() => {
    if (!lastReadAt) {
      return messages.filter((m) => !m.deleted_at && m.created_by !== userId).length
    }

    const lastReadTime = new Date(lastReadAt).getTime()

    return messages.filter(
      (m) =>
        !m.deleted_at &&
        m.created_by !== userId &&
        new Date(m.created_at).getTime() > lastReadTime
    ).length
  }, [lastReadAt, messages, userId])

  useEffect(() => {
    if (!conversationId) return
    if (authLoading) return

    let cancelled = false

    const fetchFullById = async (id: string) => {
      const res = await apiFetch(
        `/api/private-conversations/${conversationId}/messages/${id}`,
        { method: 'GET' }
      )
      const json = (await res.json().catch(() => null)) as GetMessageByIdResponse | null
      if (!res.ok) return null
      return json?.item ?? null
    }

    const channel = supabase
      .channel(`private-chat-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'private_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
            console.log('INSERT payload', payload)
          try {
            const row = payload.new as { id?: string; deleted_at?: string | null } | null
            const id = row?.id
            if (!id) return
            if (row?.deleted_at) return
            if (idsRef.current.has(id)) return
            console.log('Realtime message id:', id, 'conversationId:', conversationId)
            const item = await fetchFullById(id)
            console.log('Fetched full realtime item:', item)
            if (cancelled) return
            if (item && !item.deleted_at) upsertOne(item)
          } catch {
            // ignore
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'private_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          try {
            const row = payload.new as {
              id?: string
              deleted_at?: string | null
            } | null

            const id = row?.id
            if (!id) return

            if (row?.deleted_at) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === id
                    ? { ...m, deleted_at: row.deleted_at ?? new Date().toISOString() }
                    : m
                )
              )
              return
            }

            const item = await fetchFullById(id)
            if (cancelled) return
            if (item && !item.deleted_at) upsertOne(item)
          } catch {
            // ignore
          }
        }
      )
      .subscribe((status, err) => {
        console.log('private chat channel status:', status, err)
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [apiFetch, authLoading, conversationId, upsertOne])

  useEffect(() => {
    if (!conversationId) return
    if (authLoading) return

    resetState()
    fetchInitial()
  }, [conversationId, authLoading, fetchInitial, resetState])

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
  }
}