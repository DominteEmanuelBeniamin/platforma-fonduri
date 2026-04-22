'use client'

import { useState, useCallback } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'

export function usePrivateChatUsers() {
  const { apiFetch } = useAuth()

  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(async (q: string) => {
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

      const json = await res.json()

      if (!res.ok) {
        setError(json.error ?? 'Search failed')
        return
      }

      setItems(json.items ?? [])
    } catch {
      setError('Search failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  return {
    items,
    loading,
    error,
    search,
  }
}
