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
  /** Activează reîmprospătarea la focus și la revenirea în tab. */
  refreshOnWindowFocus?: boolean
  /** Eveniment `window` care cere un refresh imediat (de exemplu după o citire reușită). */
  refreshEvent?: string
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

const REFRESH_INTERVAL_MS = 30_000

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
    const inFlightRefreshRef = useRef<{
      authGeneration: number
      effectGeneration: number
      promise: Promise<void>
    } | null>(null)
    const refreshQueuedRef = useRef<{ authGeneration: number; effectGeneration: number } | null>(null)
    const authGenerationRef = useRef(0)
    const effectGenerationRef = useRef(0)
    const activeEffectGenerationRef = useRef<number | null>(null)
    const authIdentityRef = useRef({ active, token, userId, apiFetch })
    if (
      authIdentityRef.current.active !== active ||
      authIdentityRef.current.token !== token ||
      authIdentityRef.current.userId !== userId ||
      authIdentityRef.current.apiFetch !== apiFetch
    ) {
      authIdentityRef.current = { active, token, userId, apiFetch }
      authGenerationRef.current += 1
      refreshQueuedRef.current = null
    }
    const activeRef = useRef(active)
    activeRef.current = active
    const authGeneration = authGenerationRef.current

    const refreshForGeneration = useCallback(async (expectedAuthGeneration: number, expectedEffectGeneration: number) => {
      const isCurrent = () => (
        activeRef.current &&
        authGenerationRef.current === expectedAuthGeneration &&
        activeEffectGenerationRef.current === expectedEffectGeneration
      )
      const canRefresh = () => (
        isCurrent() && document.visibilityState === 'visible' && navigator.onLine
      )
      const hasQueuedRefresh = () => {
        const queued = refreshQueuedRef.current
        return queued?.authGeneration === expectedAuthGeneration &&
          queued.effectGeneration === expectedEffectGeneration
      }
      if (!canRefresh()) return

      const inFlight = inFlightRefreshRef.current
      if (
        inFlight?.authGeneration === expectedAuthGeneration &&
        inFlight.effectGeneration === expectedEffectGeneration
      ) {
        refreshQueuedRef.current = { authGeneration: expectedAuthGeneration, effectGeneration: expectedEffectGeneration }
        await inFlight.promise
        return
      }

      const run = (async () => {
        do {
          refreshQueuedRef.current = null
          try {
            const res = await apiFetch(options.endpoint, { method: 'GET' })
            const json = await res.json().catch(() => null)
            if (res.ok && isCurrent()) {
              const value = options.parse(json)
              setState((current) => (
                sameSummary(current.value, value)
                  ? current
                  : { value, revision: current.revision + 1 }
              ))
            }
          } catch {
            // Păstrăm ultima stare pentru un indicator care nu trebuie să blocheze UI-ul.
          }
        } while (canRefresh() && hasQueuedRefresh())
      })()
      inFlightRefreshRef.current = {
        authGeneration: expectedAuthGeneration,
        effectGeneration: expectedEffectGeneration,
        promise: run,
      }

      try {
        await run
      } finally {
        if (inFlightRefreshRef.current?.promise === run) inFlightRefreshRef.current = null
      }
    }, [apiFetch])

    const refresh = useCallback(() => {
      const effectGeneration = activeEffectGenerationRef.current
      return effectGeneration === null
        ? Promise.resolve()
        : refreshForGeneration(authGeneration, effectGeneration)
    }, [authGeneration, refreshForGeneration])

    useEffect(() => {
      if (active) return
      inFlightRefreshRef.current = null
      refreshQueuedRef.current = null
      setState((current) => (
        sameSummary(current.value, options.emptyState)
          ? current
          : { value: options.emptyState, revision: current.revision + 1 }
      ))
    }, [active])

    useEffect(() => {
      if (!active || !userId) return

      const effectGeneration = ++effectGenerationRef.current
      activeEffectGenerationRef.current = effectGeneration
      const isCurrent = () => (
        activeRef.current &&
        authGenerationRef.current === authGeneration &&
        activeEffectGenerationRef.current === effectGeneration
      )
      const canRefresh = () => (
        isCurrent() && document.visibilityState === 'visible' && navigator.onLine
      )
      const refreshIfCurrent = () => {
        if (canRefresh()) void refreshForGeneration(authGeneration, effectGeneration)
      }

      let interval: number | null = null
      const stopPeriodicRefresh = () => {
        if (interval !== null) window.clearInterval(interval)
        interval = null
      }
      const startPeriodicRefresh = () => {
        stopPeriodicRefresh()
        if (document.visibilityState === 'visible' && navigator.onLine) {
          interval = window.setInterval(refreshIfCurrent, REFRESH_INTERVAL_MS)
        }
      }

      const onFocus = () => { refreshIfCurrent() }
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          startPeriodicRefresh()
          refreshIfCurrent()
        } else {
          refreshQueuedRef.current = null
          stopPeriodicRefresh()
        }
      }
      const onOnline = () => {
        startPeriodicRefresh()
        refreshIfCurrent()
      }
      const onOffline = () => {
        refreshQueuedRef.current = null
        stopPeriodicRefresh()
      }

      if (options.refreshOnWindowFocus) {
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibilityChange)
      }
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      if (options.refreshEvent) window.addEventListener(options.refreshEvent, refreshIfCurrent)

      let channel = supabase.channel(options.channelName(userId))
      for (const source of options.sources) {
        const filter = source.filter?.(userId)
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: source.table, ...(filter ? { filter } : {}) },
          refreshIfCurrent,
        )
      }
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') refreshIfCurrent()
      })
      startPeriodicRefresh()
      refreshIfCurrent()

      return () => {
        stopPeriodicRefresh()
        if (options.refreshOnWindowFocus) {
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
        if (options.refreshEvent) window.removeEventListener(options.refreshEvent, refreshIfCurrent)
        if (activeEffectGenerationRef.current === effectGeneration) {
          activeEffectGenerationRef.current = null
          refreshQueuedRef.current = null
          if (inFlightRefreshRef.current?.effectGeneration === effectGeneration) {
            inFlightRefreshRef.current = null
          }
        }
        supabase.removeChannel(channel)
      }
    }, [active, authGeneration, refreshForGeneration, userId])

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
