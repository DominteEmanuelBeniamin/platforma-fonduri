/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'

export type PrivateConversationListItem = {
  id: string
  created_at: string
  created_by: string
  last_message_at: string | null
  last_read_at: string | null
  other_last_read_at: string | null
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
    const { apiFetch, loading: authLoading, userId } = useAuth()

    const [items, setItems] = useState<PrivateConversationListItem[]>([])
    const [loading, setLoading] = useState(false)
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const inFlightRefreshRef = useRef(false)
    const mountedRef = useRef(true)

    const fetchConversations = useCallback(async () => {
        if (authLoading) return
        if (inFlightRefreshRef.current) return
      
        inFlightRefreshRef.current = true
        setLoading(true)
        setError(null)
      
        try {
          const res = await apiFetch('/api/private-conversations', { method: 'GET' })
          const json = (await res.json().catch(() => null)) as GetPrivateConversationsResponse | null
      
          if (!mountedRef.current) return
      
          if (!res.ok) {
            setError((json as any)?.error ?? 'Failed to load conversations')
            setItems([])
            return
          }
      
          setItems(json?.items ?? [])
        } catch {
          if (!mountedRef.current) return
          setError('Failed to load conversations')
          setItems([])
        } finally {
          if (mountedRef.current) {
            setLoading(false)
          }
          inFlightRefreshRef.current = false
        }
      }, [apiFetch, authLoading])
    
    const scheduleRefresh = useCallback(() => {
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current)
        }
        
        refreshTimeoutRef.current = setTimeout(() => {
            refreshTimeoutRef.current = null
            void fetchConversations()
        }, 150)
    }, [fetchConversations])

  const refresh = useCallback(async () => {
    await fetchConversations()
  }, [fetchConversations])

  const openConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedConversationId(null)
  }, [])

  const openOrCreateConversation = useCallback(
    async (targetUserId: string) => {
      if (!targetUserId) return null

      setCreating(true)
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

        if (!res.ok) {
          setError((json as any)?.error ?? 'Failed to create conversation')
          return null
        }

        const createdId = json?.item?.id ?? null
        await fetchConversations()

        if (createdId) {
          setSelectedConversationId(createdId)
        }

        return createdId
      } catch {
        setError('Failed to create conversation')
        return null
      } finally {
        setCreating(false)
      }
    },
    [apiFetch, fetchConversations, items]
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

  const getIsUnread = useCallback(
    (item: PrivateConversationListItem) => {
      const lastMessage = item.last_message
      if (!lastMessage) return false
      if (!userId) return false
      if (lastMessage.created_by === userId) return false
      if (!item.last_read_at) return true

      return new Date(lastMessage.created_at).getTime() > new Date(item.last_read_at).getTime()
    },
    [userId]
  )

  const markConversationReadLocally = useCallback(
    (conversationId: string, lastReadAt: string | null) => {
      if (!lastReadAt) return
  
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== conversationId) return item
          if (item.last_read_at === lastReadAt) return item
  
          return {
            ...item,
            last_read_at: lastReadAt,
          }
        })
      )
    },
    []
  )

  useEffect(() => {
    if (authLoading) return
    void fetchConversations()
  }, [authLoading, fetchConversations])

  useEffect(() => {
    if (!userId) return
  
    const channel = supabase
      .channel(`private-conversations-list-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_messages',
        },
        () => {
          scheduleRefresh()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_conversations',
        },
        () => {
          scheduleRefresh()
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
          scheduleRefresh()
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void fetchConversations()
        }
      })
  
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
        refreshTimeoutRef.current = null
      }
      supabase.removeChannel(channel)
    }
  }, [fetchConversations, scheduleRefresh, userId])

  useEffect(() => {
    mountedRef.current = true
  
    return () => {
      mountedRef.current = false
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
        refreshTimeoutRef.current = null
      }
    }
  }, [])

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
