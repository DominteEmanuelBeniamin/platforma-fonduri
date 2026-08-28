'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'

export type UnreadRealtimeSource = {
  table: string
  /** Filtru `postgres_changes`; lipsa lui ascultă toată tabela. */
  filter?: (userId: string) => string
}

export type UnreadSummaryOptions<TState extends object> = {
  /** Numele folosit în mesajul de eroare când hook-ul e chemat în afara provider-ului. */
  name: string
  endpoint: string
  emptyState: TState
  parse: (payload: unknown) => TState
  channelName: (userId: string) => string
  sources: UnreadRealtimeSource[]
  /** Doar indicatorii care alimentează un panou deschis au nevoie de reîmprospătare la revenirea în tab. */
  refreshOnWindowFocus?: boolean
}

export type UnreadSummaryValue<TState> = TState & {
  active: boolean
  /** Crește doar când sumarul chiar s-a schimbat, ca un consumator să distingă o noutate de o verificare fără rezultat. */
  revision: number
  refresh: () => Promise<void>
}

function sameSummary(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Indicatorii de necitit (chat de proiect, notificări) au același ciclu de
 * viață: sesiune activă, un refresh dedublat, abonare realtime și golire când
 * accesul dispare. Îl ținem într-un singur loc, ca o corecție să nu trebuiască
 * făcută de două ori.
 */
export function createUnreadSummaryProvider<TState extends object>(options: UnreadSummaryOptions<TState>) {
  const Context = createContext<UnreadSummaryValue<TState> | null>(null)
  Context.displayName = options.name

  function Provider({ children }: { children: ReactNode }) {
    const { apiFetch, loading: authLoading, token, userId } = useAuth()
    const active = !authLoading && !!token && !!userId
    const [state, setState] = useState<{ value: TState; revision: number }>(
      () => ({ value: options.emptyState, revision: 0 }),
    )
    const inFlightRefreshRef = useRef<Promise<void> | null>(null)
    const refreshQueuedRef = useRef(false)
    const generationRef = useRef(0)
    const activeRef = useRef(active)
    if (activeRef.current !== active) {
      activeRef.current = active
      generationRef.current += 1
    }

    const refresh = useCallback(async () => {
      if (!activeRef.current) return

      const inFlight = inFlightRefreshRef.current
      if (inFlight) {
        refreshQueuedRef.current = true
        await inFlight
        if (refreshQueuedRef.current && activeRef.current) {
          refreshQueuedRef.current = false
          await refresh()
        }
        return
      }

      const generation = generationRef.current
      // Ștergerea se face pe identitatea rulării, nu pe generație: dacă `active`
      // se schimbă cât cererea e în aer, o condiție pe generație lasă în ref o
      // promisiune deja rezolvată, iar orice `refresh()` de după intră la
      // nesfârșit în ramura „e una în curs”.
      const run = (async () => {
        try {
          const res = await apiFetch(options.endpoint, { method: 'GET' })
          const json = await res.json().catch(() => null)
          if (!res.ok || generation !== generationRef.current || !activeRef.current) return

          const value = options.parse(json)
          setState((current) => (
            sameSummary(current.value, value)
              ? current
              : { value, revision: current.revision + 1 }
          ))
        } catch {
          // Păstrăm ultima stare pentru un indicator care nu trebuie să blocheze UI-ul.
        }
      })()
      inFlightRefreshRef.current = run

      // Cel care a pornit rularea o și eliberează, iar el reia primul după ce
      // promisiunea se stinge: cine a așteptat-o găsește ref-ul deja gol.
      try {
        await run
      } finally {
        if (inFlightRefreshRef.current === run) inFlightRefreshRef.current = null
      }
    }, [apiFetch])

    useEffect(() => {
      if (active) return
      inFlightRefreshRef.current = null
      refreshQueuedRef.current = false
      setState((current) => ({ value: options.emptyState, revision: current.revision }))
    }, [active])

    useEffect(() => {
      if (!active || !userId) return

      void refresh()

      const onFocus = () => { void refresh() }
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') void refresh()
      }

      if (options.refreshOnWindowFocus) {
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibilityChange)
      }

      let channel = supabase.channel(options.channelName(userId))
      for (const source of options.sources) {
        const filter = source.filter?.(userId)
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: source.table, ...(filter ? { filter } : {}) },
          () => { void refresh() },
        )
      }
      channel.subscribe()

      return () => {
        if (options.refreshOnWindowFocus) {
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
        supabase.removeChannel(channel)
      }
    }, [active, refresh, userId])

    const value = useMemo<UnreadSummaryValue<TState>>(
      () => ({ ...state.value, active, revision: state.revision, refresh }),
      [active, refresh, state],
    )

    return <Context.Provider value={value}>{children}</Context.Provider>
  }

  function useSummary(enabled = true): UnreadSummaryValue<TState> {
    const value = useContext(Context)
    if (!value) throw new Error(`${options.name} must be used within its provider`)

    const active = enabled && value.active
    return active
      ? value
      : { ...options.emptyState, active: false, revision: 0, refresh: value.refresh }
  }

  return { Provider, useSummary }
}
