'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'

export type ChatMessage = {
  id: string
  project_id: string
  created_by: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
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

export function useProjectChat(projectId: string, opts: UseProjectChatOptions = {}) {
  const { apiFetch, loading: authLoading } = useAuth()
  const initialLimit = opts.initialLimit ?? 50

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

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

  // Realtime: INSERT only, filtered by project_id
  useEffect(() => {
    if (!projectId) return
    if (authLoading) return

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
        (payload) => {
          const row = payload.new as ChatMessage
          if (!row) return
          // dacă e soft-deleted (nu ar trebui la INSERT), ignorăm
          if (row.deleted_at) return
          pushOne(row)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [authLoading, projectId, pushOne])

  // Re-fetch când se schimbă projectId
  useEffect(() => {
    resetState()
    // nu chemăm fetch dacă nu e projectId
    if (!projectId) return
    // fetch după reset
    fetchInitial()
  }, [projectId]) // intenționat doar projectId (fetchInitial are token deps deja)

  const hasMore = useMemo(() => !!nextCursor, [nextCursor])

  return {
    messages,
    loading,
    sending,
    error,
    hasMore,
    nextCursor,
    fetchInitial,
    loadMore,
    sendMessage,
    setError,
  }
}
