'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'
import { userErrorMessage } from '@/lib/user-error'

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

export type ProjectChatReadState = {
  project_id: string
  user_id: string
  last_read_at: string | null
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

type ReadResponse = {
  ok: true
  lastReadAt: string | null
  readStates: ProjectChatReadState[]
}

const maxIso = (a: string | null, b: string | null) => {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

const mergeReadState = (
  rows: ProjectChatReadState[],
  incoming: ProjectChatReadState
) => {
  const existing = rows.find((row) => row.user_id === incoming.user_id)
  if (!existing) return rows.concat(incoming)

  return rows.map((row) => {
    if (row.user_id !== incoming.user_id) return row

    return {
      ...row,
      last_read_at: maxIso(row.last_read_at, incoming.last_read_at),
    }
  })
}

export function useProjectChat(projectId: string, opts: UseProjectChatOptions = {}) {
  const { apiFetch, loading: authLoading, userId } = useAuth()
  const initialLimit = opts.initialLimit ?? 50

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)
  const [readStates, setReadStates] = useState<ProjectChatReadState[]>([])

  const idsRef = useRef<Set<string>>(new Set())

  const resetState = useCallback(() => {
    idsRef.current = new Set()
    setMessages([])
    setNextCursor(null)
    setError(null)
    setLoading(false)
    setSending(false)
    setLastReadAt(null)
    setReadStates([])
  }, [])

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

  const upsertOne = useCallback((m: ChatMessage) => {
    idsRef.current.add(m.id)

    setMessages((prev) => {
      const existing = prev.find((x) => x.id === m.id)

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

  const pushOne = useCallback((m: ChatMessage) => {
    if (idsRef.current.has(m.id)) return
    idsRef.current.add(m.id)

    setMessages((prev) => {
      const next = prev.concat(m)
      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      return next
    })
  }, [])

  const refreshReadState = useCallback(async () => {
    if (!projectId) return
    if (authLoading) return

    try {
      const res = await apiFetch(`/api/projects/${projectId}/chat/read`, { method: 'GET' })
      const json = (await res.json().catch(() => null)) as ReadResponse | null

      if (!res.ok || !json?.ok) return

      setLastReadAt((prev) => maxIso(prev, json.lastReadAt))
      setReadStates(json.readStates ?? [])
    } catch {
      // silent fail; the chat still works without read receipts.
    }
  }, [apiFetch, authLoading, projectId])

  const markAsRead = useCallback(
    async (readThroughAt?: string | null) => {
      if (!projectId) return
      if (authLoading) return

      try {
        const res = await apiFetch(`/api/projects/${projectId}/chat/read`, {
          method: 'POST',
          body: JSON.stringify({ readThroughAt: readThroughAt ?? undefined }),
        })
        const json = (await res.json().catch(() => null)) as ReadResponse | null

        if (!res.ok || !json?.ok) return

        setLastReadAt((prev) => maxIso(prev, json.lastReadAt))
        setReadStates(json.readStates ?? [])
      } catch {
        // silent fail
      }
    },
    [apiFetch, authLoading, projectId]
  )

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
          setError(userErrorMessage(res.status, 'Nu am putut edita mesajul.'))
          return
        }

        if (json?.item) upsertOne(json.item)
      } catch {
        setError(userErrorMessage(undefined, 'Nu am putut edita mesajul.'))
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
          setError(userErrorMessage(res.status, 'Nu am putut șterge mesajul.'))
          return
        }

        const nowIso = new Date().toISOString()
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, deleted_at: nowIso } : m))
        )
      } catch {
        setError(userErrorMessage(undefined, 'Nu am putut șterge mesajul.'))
      }
    },
    [apiFetch, projectId]
  )

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
        setError(userErrorMessage(res.status, 'Nu am putut încărca mesajele.'))
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
      setError(userErrorMessage(undefined, 'Nu am putut încărca mesajele.'))
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
        setError(userErrorMessage(res.status, 'Nu am putut încărca mesajele mai vechi.'))
        return
      }

      const apiItems = json?.items ?? []
      const cursor = json?.nextCursor ?? null
      const oldestFirst = apiItems.slice().reverse()

      setMessages((prev) => {
        const merged = [...oldestFirst, ...prev]
        const seen = new Set<string>()
        const out: ChatMessage[] = []

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
      setError(userErrorMessage(undefined, 'Nu am putut încărca mesajele mai vechi.'))
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
          setError(userErrorMessage(res.status, 'Nu am putut trimite mesajul.'))
          return
        }

        const item = json?.item
        if (item) pushOne(item)
      } catch {
        setError(userErrorMessage(undefined, 'Nu am putut trimite mesajul.'))
      } finally {
        setSending(false)
      }
    },
    [apiFetch, projectId, pushOne]
  )

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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_chat_reads',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.new as ProjectChatReadState | null
          if (!row?.user_id) return

          setReadStates((prev) => mergeReadState(prev, row))

          if (row.user_id === userId) {
            setLastReadAt((prev) => maxIso(prev, row.last_read_at))
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [apiFetch, authLoading, projectId, upsertOne, userId])

  useEffect(() => {
    if (!projectId) return
    if (authLoading) return
    resetState()
    fetchInitial()
  }, [projectId, authLoading, fetchInitial, resetState])

  useEffect(() => {
    if (!projectId) return
    if (authLoading) return
    void refreshReadState()
  }, [authLoading, projectId, refreshReadState])

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
    readStates,
    refreshReadState,
  }
}
