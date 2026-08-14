'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReminderEntityState, ReminderStateMap } from '@/lib/reminder-state'

type ApiFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>

export function useReminderStates(
  apiFetch: ApiFetch,
  entityType: 'request' | 'activity',
  ids: string[],
  enabled = true,
) {
  const idsKey = useMemo(() => [...new Set(ids)].filter(Boolean).sort().join(','), [ids])
  const [states, setStates] = useState<ReminderStateMap>({})
  const [loading, setLoading] = useState(enabled && Boolean(idsKey))
  const [loadedKey, setLoadedKey] = useState('')

  const refresh = useCallback(async () => {
    if (!enabled || !idsKey) {
      setStates({})
      setLoadedKey('')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const idList = idsKey.split(',')
      const chunks: string[][] = []
      for (let index = 0; index < idList.length; index += 100) chunks.push(idList.slice(index, index + 100))
      const responses = await Promise.all(chunks.map(chunk => apiFetch(
        '/api/deadline-reminders/state?entity_type=' + entityType + '&ids=' + encodeURIComponent(chunk.join(',')),
      )))
      const merged: ReminderStateMap = {}
      let loaded = false
      for (const response of responses) {
        if (!response.ok) continue
        loaded = true
        const data = await response.json().catch(() => null)
        Object.assign(merged, data?.states ?? {})
      }
      setStates(merged)
      if (loaded) setLoadedKey(idsKey)
    } catch {
      // The UI keeps the last known state; a later focus/visibility refresh retries.
    } finally {
      setLoading(false)
    }
  }, [apiFetch, enabled, entityType, idsKey])

  useEffect(() => {
    if (!enabled || !idsKey) {
      setStates({})
      setLoadedKey('')
      setLoading(false)
      return
    }
    void refresh()
    const onFocus = () => { void refresh() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, idsKey, refresh])

  return {
    states,
    refresh,
    loading: enabled && Boolean(idsKey) && (loading || loadedKey !== idsKey),
    get: (id: string): ReminderEntityState | undefined => states[id],
  }
}
