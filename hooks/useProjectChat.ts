/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'

export type ChatProfile = {
  id: string
  full_name: string | null
  email: string | null
}

export type ChatMessage = {
  id: string
  project_id: string
  created_by: string
  body: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  profiles: ChatProfile | null
  is_deleted?: boolean
}

type GetResponse = {
  items: ChatMessage[]
  nextCursor: string | null
}

type PostResponse = {
  item: ChatMessage
}

type UseProjectChatOptions = {
  initialLimit?: number
}

type DeleteResponse = {
  ok: true
}
type PatchResponse = {
  item: ChatMessage
}
type GetByIdResponse = {
  item: ChatMessage
}

const LAST_SEEN_KEY = (projectId: string) => `chat_last_seen_${projectId}`

export function useProjectChat(projectId: string, opts: UseProjectChatOptions = {}) {
  const { apiFetch, loading: authLoading, userId } = useAuth()
  const initialLimit = opts.initialLimit ?? 50

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(LAST_SEEN_KEY(projectId))
  })

  const markAsRead = useCallback(() => {
    const now = new Date().toISOString()
    localStorage.setItem(LAST_SEEN_KEY(projectId), now)
    setLastSeenAt(now)
  }, [projectId])

  const unreadCount = useMemo(() => {
    if (!lastSeenAt) {
      // dacă nu ai văzut niciodată, toate mesajele altora sunt "unread"
      return messages.filter((m) => !m.deleted_at && m.created_by !== userId).length
    }
    return messages.filter(
      (m) =>
        !m.deleted_at &&
        m.created_by !== userId &&
        new Date(m.created_at).getTime() > new Date(lastSeenAt).getTime()
    ).length
  }, [messages, lastSeenAt, userId])


  const upsertOne = useCallback((m: ChatMessage) => {
    idsRef.current.add(m.id)
  
    setMessages((prev) => {
      const existing = prev.find((x) => x.id === m.id)
  
      // dacă noul mesaj nu are profiles, păstrează-le pe cele vechi
      const merged: ChatMessage = existing
        ? { ...existing, ...m, profiles: m.profiles ?? existing.profiles }
        : m
  
      const next = existing
        ? prev.map((x) => (x.id === m.id ? merged : x))
        : prev.concat(merged)
  
      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      return next
    })
  }, [])
  

  const editMessage = useCallback(
    async (messageId: string, body: string) => {
      const trimmed = body.trim()
      if (!trimmed) return
  
      setError(null)
      try {
        const res = await apiFetch(`/api/projects/${projectId}/chat/messages/${messageId}`, {
          method: 'PATCH',
          body: JSON.stringify({ body: trimmed }),
        })
        const json = (await res.json().catch(() => null)) as PatchResponse | null
  
        if (!res.ok) {
          setError((json as any)?.error ?? 'Failed to edit message')
          return
        }
  
        if (json?.item) upsertOne(json.item)
      } catch {
        setError('Failed to edit message')
      }
    },
    [apiFetch, projectId, upsertOne]
  )
  
  
  const deleteMessage = useCallback(
    async (messageId: string) => {
      setError(null)
      try {
        const res = await apiFetch(`/api/projects/${projectId}/chat/messages/${messageId}`, {
          method: 'DELETE',
        })
        const json = (await res.json().catch(() => null)) as DeleteResponse | null
  
        if (!res.ok || !json?.ok) {
          setError((json as any)?.error ?? 'Failed to delete message')
          return
        }
  
        // soft delete local (API nu returnează item)
        const nowIso = new Date().toISOString()
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, deleted_at: nowIso } : m))
        )
      } catch {
        setError('Failed to delete message')
      }
    },
    [apiFetch, projectId]
  )

  // pentru dedupe rapid (evită dubluri din POST + realtime)
  const idsRef = useRef<Set<string>>(new Set())

  const resetState = useCallback(() => {
    idsRef.current = new Set()
    setMessages([])
    setNextCursor(null)
    setError(null)
    setLoading(false)
    setSending(false)
  }, [])

  const pushManyOldestFirst = useCallback((incomingOldestFirst: ChatMessage[]) => {
    if (incomingOldestFirst.length === 0) return

    setMessages((prev) => {
      let changed = false
      const next = prev.slice()

      for (const m of incomingOldestFirst) {
        if (idsRef.current.has(m.id)) continue
        idsRef.current.add(m.id)
        next.push(m)
        changed = true
      }

      // ne asigurăm că rămâne chronological (oldest -> newest)
      if (changed) {
        next.sort((a, b) => {
          const ta = new Date(a.created_at).getTime()
          const tb = new Date(b.created_at).getTime()
          return ta - tb
        })
        return next
      }
      return prev
    })
  }, [])

  const pushOne = useCallback((m: ChatMessage) => {
    if (idsRef.current.has(m.id)) return
    idsRef.current.add(m.id)

    setMessages((prev) => {
      const next = prev.concat(m)
      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      return next
    })
  }, [])

  const fetchInitial = useCallback(async () => {
    if (!projectId) return
    if (authLoading) return

    setLoading(true)
    setError(null)

    try {
      const res = await apiFetch(`/api/projects/${projectId}/chat/messages?limit=${initialLimit}`, {
        method: 'GET',
      })
      const json = (await res.json().catch(() => null)) as GetResponse | null

      if (!res.ok) {
        setError((json as any)?.error ?? 'Failed to load messages')
        resetState()
        return
      }

      const apiItems = json?.items ?? []
      const cursor = json?.nextCursor ?? null

      // API: newest first (desc). UI: oldest->newest.
      const oldestFirst = apiItems.slice().reverse()

      // reset ids + set state
      idsRef.current = new Set(oldestFirst.map((m) => m.id))
      setMessages(oldestFirst)
      setNextCursor(cursor)
    } catch (_e) {
      setError('Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, authLoading, initialLimit, projectId, resetState])

  const loadMore = useCallback(async () => {
    if (!projectId) return
    if (authLoading) return
    if (!nextCursor) return
    if (loading) return

    setLoading(true)
    setError(null)

    try {
      const url = `/api/projects/${projectId}/chat/messages?limit=${initialLimit}&cursor=${encodeURIComponent(
        nextCursor
      )}`

      const res = await apiFetch(url, { method: 'GET' })
      const json = (await res.json().catch(() => null)) as GetResponse | null

      if (!res.ok) {
        setError((json as any)?.error ?? 'Failed to load more messages')
        return
      }

      const apiItems = json?.items ?? []
      const cursor = json?.nextCursor ?? null

      // API: desc. convert to oldestFirst.
      const oldestFirst = apiItems.slice().reverse()

      // acestea sunt "older" mesaje, deci trebuie prepend,
      // dar păstrăm sortarea finală și dedupe.
      setMessages((prev) => {
        const merged = [...oldestFirst, ...prev]
        const seen = new Set<string>()
        const out: ChatMessage[] = []
        for (const m of merged) {
          if (seen.has(m.id)) continue
          seen.add(m.id)
          out.push(m)
        }
        // update idsRef
        idsRef.current = new Set(out.map((m) => m.id))
        out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        return out
      })

      setNextCursor(cursor)
    } catch (_e) {
      setError('Failed to load more messages')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, authLoading, initialLimit, loading, nextCursor, projectId])

  const sendMessage = useCallback(
    async (body: string) => {
      const trimmed = body.trim()
      if (!trimmed) return

      setSending(true)
      setError(null)

      try {
        const res = await apiFetch(`/api/projects/${projectId}/chat/messages`, {
          method: 'POST',
          body: JSON.stringify({ body: trimmed }),
        })
        const json = (await res.json().catch(() => null)) as PostResponse | null

        if (!res.ok) {
          setError((json as any)?.error ?? 'Failed to send message')
          return
        }

        const item = json?.item
        if (item) pushOne(item)
      } catch (_e) {
        setError('Failed to send message')
      } finally {
        setSending(false)
      }
    },
    [apiFetch, projectId, pushOne]
  )

  // Realtime
  useEffect(() => {
    if (!projectId) return
    if (authLoading) return
  
    let cancelled = false
  
    const fetchFullById = async (id: string) => {
      const res = await apiFetch(`/api/projects/${projectId}/chat/messages/${id}`, { method: 'GET' })
      const json = (await res.json().catch(() => null)) as GetByIdResponse | null
      if (!res.ok) return null
      return json?.item ?? null
    }
  
    const channel = supabase
      .channel(`project-chat-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'project_chat_messages',
          filter: `project_id=eq.${projectId}`,
        },
        async (payload) => {
          try {
            const row = payload.new as { id?: string; deleted_at?: string | null } | null
            const id = row?.id
            if (!id) return
            if (row?.deleted_at) return
  
            // dedupe: dacă l-ai pus deja (POST)
            if (idsRef.current.has(id)) return
  
            const item = await fetchFullById(id)
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
          table: 'project_chat_messages',
          filter: `project_id=eq.${projectId}`,
        },
        async (payload) => {
          try {
            const row = payload.new as {
              id?: string
              deleted_at?: string | null
              body?: string
              edited_at?: string | null
            } | null
  
            const id = row?.id
            if (!id) return
  
            // 1) dacă a devenit deleted -> NU fetch (GET by id dă 404), marchează local
            if (row?.deleted_at) {
              setMessages((prev) =>
                prev.map((m) => (m.id === id ? { ...m, deleted_at: row.deleted_at ?? new Date().toISOString() } : m))
              )
              return
            }
  
            // 2) edit -> fetch full (cu profiles) și upsert
            const item = await fetchFullById(id)
            if (cancelled) return
            if (item && !item.deleted_at) upsertOne(item)
          } catch {
            // ignore
          }
        }
      )
      .subscribe()
  
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [apiFetch, authLoading, projectId, upsertOne])
  

  // Re-fetch când se schimbă projectId
  useEffect(() => {
    if (!projectId) return
    if (authLoading) return
    resetState()
    fetchInitial()
  }, [projectId, authLoading, fetchInitial, resetState])
  
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
  }
}