'use client'

import { useState, useCallback, useRef } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'

export type PrivateChatUserSearchItem = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  hasConversation: boolean
  conversationId: string | null
}

type SearchUsersResponse = {
  items?: PrivateChatUserSearchItem[]
  error?: string
}

export function usePrivateChatUsers() {
  const { apiFetch } = useAuth()

  const [items, setItems] = useState<PrivateChatUserSearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchSeqRef = useRef(0)

  const search = useCallback(async (q: string) => {
    const searchSeq = searchSeqRef.current + 1
    searchSeqRef.current = searchSeq

    if (!q.trim()) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await apiFetch(
        `/api/private-conversations/users?q=${encodeURIComponent(q)}`
      )

      const json = (await res.json().catch(() => null)) as SearchUsersResponse | null

      if (searchSeqRef.current !== searchSeq) return

      if (!res.ok) {
        setError(json?.error ?? 'Search failed')
        return
      }

      setItems(json?.items ?? [])
    } catch {
      if (searchSeqRef.current !== searchSeq) return
      setError('Search failed')
    } finally {
      if (searchSeqRef.current === searchSeq) {
        setLoading(false)
      }
    }
  }, [apiFetch])

  return {
    items,
    loading,
    error,
    search,
  }
}
