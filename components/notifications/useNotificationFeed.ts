'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useNotifications } from '@/app/providers/NotificationsProvider'
import { useToast } from '@/app/providers/ToastProvider'

export type NotificationItem = {
  id: string
  projectId: string
  projectTitle: string | null
  type: string
  severity: string
  entityType: string
  entityId: string
  title: string
  actorName: string | null
  entityLabel: string | null
  itemCount: number
  createdAt: string
  readAt: string | null
}

export type NotificationFilters = {
  status: 'all' | 'unread'
  /** Gol = toate categoriile. */
  type: string
  /** Gol = toate proiectele. */
  projectId: string
}

export const ALL_NOTIFICATIONS: NotificationFilters = { status: 'all', type: '', projectId: '' }

type FeedOptions = {
  /** Panoul cere o listă scurtă; pagina cere pagini întregi. */
  limit?: number
  /** Cât timp e fals, feed-ul nu cere nimic: panoul închis nu are ce afișa. */
  active: boolean
  filters?: NotificationFilters
  /** Numai pagina are „Încarcă mai multe”. */
  paginate?: boolean
}

type LoadMode = 'replace' | 'append' | 'merge'

type NotificationsResponse = {
  items?: NotificationItem[]
  nextCursor?: string | null
  error?: string
}

function sortByNewest(items: NotificationItem[]) {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/**
 * O singură sursă pentru clopoțel și pentru pagina de notificări: aceleași
 * cereri, aceleași mesaje de eroare, aceeași reîmprospătare a contorului.
 * Diferă doar câte rânduri cer și ce controale arată.
 */
export function useNotificationFeed({ limit, active, filters = ALL_NOTIFICATIONS, paginate = false }: FeedOptions) {
  const { apiFetch } = useAuth()
  const { refresh, revision } = useNotifications()
  const { showToast } = useToast()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const seenRevision = useRef(revision)
  const { status, type, projectId } = filters

  // 'replace' reîncarcă lista de la zero, 'append' adaugă pagina următoare, iar
  // 'merge' aduce doar prima pagină peste ce e deja afișat: o notificare nouă
  // sosită cât panoul e deschis nu are voie să arunce paginile încărcate de
  // utilizator, așa că nici cursorul, nici poziția lui nu se pierd.
  const loadPage = useCallback(async (mode: LoadMode, cursor: string | null = null) => {
    const sequence = mode === 'merge' ? requestSequence.current : ++requestSequence.current
    setLoading(true)
    if (mode === 'replace') setError(false)

    try {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      if (projectId) params.set('projectId', projectId)
      if (type) params.set('type', type)
      if (status === 'unread') params.set('unreadOnly', 'true')
      if (limit) params.set('limit', String(limit))

      const res = await apiFetch(`/api/notifications?${params.toString()}`, { method: 'GET' })
      const json = (await res.json().catch(() => null)) as NotificationsResponse | null
      if (!res.ok) throw new Error(json?.error || 'Nu am putut încărca notificările.')
      if (sequence !== requestSequence.current) return

      const incoming = Array.isArray(json?.items) ? json.items : []
      setItems((current) => {
        if (mode === 'replace') return sortByNewest(incoming)
        // Rândurile primite câștigă: aduc `readAt` proaspăt pentru cele deja afișate.
        const byId = new Map(current.map((item) => [item.id, item]))
        for (const item of incoming) byId.set(item.id, item)
        return sortByNewest([...byId.values()])
      })
      if (mode !== 'merge') setNextCursor(paginate ? json?.nextCursor ?? null : null)
    } catch {
      // Un merge de fundal care eșuează nu are voie să înlocuiască lista afișată
      // cu ecranul de eroare — utilizatorul n-a cerut nimic.
      if (mode !== 'merge' && sequence === requestSequence.current) setError(true)
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [apiFetch, limit, paginate, projectId, status, type])

  useEffect(() => {
    if (!active) return
    void loadPage('replace')
  }, [active, loadPage])

  // `revision` crește doar când sumarul chiar s-a schimbat, iar lista deschisă
  // primește noutățile printr-un merge, nu printr-o reîncărcare de la capăt.
  useEffect(() => {
    if (!active) {
      seenRevision.current = revision
      return
    }
    if (seenRevision.current === revision) return
    seenRevision.current = revision
    void loadPage('merge')
  }, [active, loadPage, revision])

  const reset = useCallback(() => {
    requestSequence.current += 1
    setItems([])
    setNextCursor(null)
    setError(false)
    setLoading(false)
  }, [])

  const loadMore = useCallback(() => {
    if (!nextCursor || loading) return
    void loadPage('append', nextCursor)
  }, [loadPage, loading, nextCursor])

  const setRead = useCallback(async (ids: string[] | null, read: boolean) => {
    if (ids && ids.length === 0) return true

    try {
      const res = await apiFetch('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify(ids ? { ids, read } : {}),
      })
      if (!res.ok) throw new Error('failed')

      const readAt = read ? new Date().toISOString() : null
      setItems((current) => current.map((item) => (
        !ids || ids.includes(item.id) ? { ...item, readAt } : item
      )))
      await refresh()
      // „Marchează tot ca citit” sub filtrul „Necitite” golește lista. Un merge
      // n-ar scoate niciun rând — aduce doar ce vine de la server — așa că
      // rândurile tocmai citite ar rămâne afișate sub un filtru care le exclude.
      if (!ids && status === 'unread') await loadPage('replace')
      return true
    } catch {
      showToast(
        read ? 'Nu am putut marca notificările ca citite.' : 'Nu am putut marca notificarea ca necitită.',
        'error',
      )
      return false
    }
  }, [apiFetch, loadPage, refresh, showToast, status])

  const dismiss = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return true

    try {
      const res = await apiFetch('/api/notifications/dismiss', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('failed')

      setItems((current) => current.filter((item) => !ids.includes(item.id)))
      await refresh()
      return true
    } catch {
      showToast('Nu am putut șterge notificarea.', 'error')
      return false
    }
  }, [apiFetch, refresh, showToast])

  /**
   * Ținta se rezolvă la clic, nu se ține ca URL în baza de date. Citirea se
   * marchează înainte de navigare: după `assign` nu mai rulează nimic din
   * pagina asta.
   */
  const openTarget = useCallback(async (item: NotificationItem) => {
    if (pendingId) return
    setPendingId(item.id)
    try {
      const res = await apiFetch(`/api/notifications/${encodeURIComponent(item.id)}/target`, { method: 'GET' })
      const json = (await res.json().catch(() => null)) as { href?: string; error?: string } | null
      if (res.status === 404) {
        showToast('Ținta acestei notificări nu mai există.', 'error')
        return
      }
      if (!res.ok || !json?.href) {
        showToast('Nu am putut deschide notificarea.', 'error')
        return
      }

      if (!item.readAt) await setRead([item.id], true)
      const targetUrl = new URL(json.href, window.location.origin)
      if (targetUrl.href === window.location.href) {
        window.location.reload()
      } else {
        window.location.assign(targetUrl.href)
      }
    } catch {
      showToast('Nu am putut deschide notificarea.', 'error')
    } finally {
      setPendingId(null)
    }
  }, [apiFetch, pendingId, setRead, showToast])

  return {
    items,
    loading,
    error,
    hasMore: !!nextCursor,
    pendingId,
    unreadIds: items.filter((item) => !item.readAt).map((item) => item.id),
    reload: () => loadPage('replace'),
    reset,
    loadMore,
    setRead,
    dismiss,
    openTarget,
  }
}
