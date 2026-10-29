'use client'

import { useState, useCallback, useRef } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import { userErrorMessage } from '@/lib/user-error'

export type PrivateChatUserSearchItem = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  specializare?: string | null
  hasConversation: boolean
  conversationId: string | null
}

type SearchUsersResponse = {
  items?: PrivateChatUserSearchItem[]
  error?: string
}

const SEARCH_DEBOUNCE_MS = 300

export function usePrivateChatUsers() {
  const { apiFetch } = useAuth()

  const [items, setItems] = useState<PrivateChatUserSearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchSeqRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string) => {
    const searchSeq = searchSeqRef.current + 1
    searchSeqRef.current = searchSeq
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!q.trim()) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    // Căutarea merge la server: așteptăm o pauză în tastare (#112).
    await new Promise<void>(resolve => {
      timerRef.current = setTimeout(resolve, SEARCH_DEBOUNCE_MS)
    })
    if (searchSeqRef.current !== searchSeq) return

    try {
      const res = await apiFetch(
        `/api/private-conversations/users?q=${encodeURIComponent(q)}`
      )

      const json = (await res.json().catch(() => null)) as SearchUsersResponse | null

      if (searchSeqRef.current !== searchSeq) return

      if (!res.ok) {
        setError(userErrorMessage(res.status, 'Nu am putut căuta utilizatorii.'))
        return
      }

      setItems(json?.items ?? [])
    } catch {
      if (searchSeqRef.current !== searchSeq) return
      setError(userErrorMessage(undefined, 'Nu am putut căuta utilizatorii.'))
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
