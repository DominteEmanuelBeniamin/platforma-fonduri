'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, List, Loader2 } from 'lucide-react'

import {
  addMonths,
  deadlineKey,
  defaultFilters,
  eventProgress,
  filterEvents,
  formatMonthTitle,
  readFiltersFromParams,
  readMonth,
  readViewMode,
  writeFiltersToParams,
  writeMonth,
  writeViewMode,
  type CalendarEvent,
  type CalendarFilterState,
  type CalendarPayload,
  type CalendarViewMode,
} from '@/lib/calendar'
import { useAuth } from '@/app/providers/AuthProvider'
import CalendarFilters, { type OwnerOption } from '@/components/calendar/CalendarFilters'
import CalendarMonthGrid from '@/components/calendar/CalendarMonthGrid'
import CalendarDayDialog from '@/components/calendar/CalendarDayDialog'
import DeadlineList from '@/components/calendar/DeadlineList'

interface CalendarSurfaceProps {
  /** Calendarul unui proiect. Lipsă = calendarul general, peste toate proiectele. */
  projectId?: string
}

/**
 * Suprafața de calendar, aceeași în pagina proiectului și în `/calendar`.
 * Adună datele dintr-o singură rută (`/api/calendar`), ține filtrele în URL și
 * comută între vederea Lună și vederea Listă.
 *
 * Nu modifică nimic: termenele se schimbă din fișa activității sau a cererii.
 */
export default function CalendarSurface({ projectId }: CalendarSurfaceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { loading: authLoading, token, apiFetch } = useAuth()

  const [payload, setPayload] = useState<CalendarPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterOverride, setFilterOverride] = useState<CalendarFilterState | null>(null)
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => readViewMode(new URLSearchParams(searchParams.toString())))
  const [month, setMonth] = useState<Date>(() => readMonth(new URLSearchParams(searchParams.toString())))
  const [openDayKey, setOpenDayKey] = useState<string | null>(null)

  const scope = projectId ? 'project' : 'global'

  // ─── Încărcare ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(projectId ? `/api/calendar?project_id=${projectId}` : '/api/calendar')
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // `apiFetch` înlocuiește `error` cu un mesaj generic; motivul real vine
        // pe `message` (convenția din #70).
        setError(data?.message || 'Nu am putut încărca termenele.')
        return
      }
      setPayload(data as CalendarPayload)
    } catch {
      setError('Nu am putut încărca termenele.')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, projectId])

  useEffect(() => {
    if (authLoading || !token) return
    load()
  }, [authLoading, token, load])

  const defaults = useMemo(
    () => (payload ? defaultFilters(payload.role, payload.user_id) : null),
    [payload]
  )

  // Filtrele se pot citi din URL abia când se știe rolul: implicitul
  // consultantului („ale mele") e altul decât al administratorului. Până la
  // prima interacțiune conduce URL-ul; după ea, starea locală — altfel fiecare
  // bifă ar aștepta o navigare ca să se vadă.
  const filters = useMemo(() => {
    if (filterOverride) return filterOverride
    if (!defaults) return null
    return readFiltersFromParams(new URLSearchParams(searchParams.toString()), defaults)
  }, [filterOverride, defaults, searchParams])

  // ─── Stare în URL ───────────────────────────────────────────────────────────

  const syncUrl = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const changeFilters = (next: CalendarFilterState) => {
    if (!defaults) return
    setFilterOverride(next)
    syncUrl(params => writeFiltersToParams(params, next, defaults))
  }

  const changeView = (mode: CalendarViewMode) => {
    setViewMode(mode)
    syncUrl(params => writeViewMode(params, mode))
  }

  const changeMonth = (next: Date) => {
    setMonth(next)
    syncUrl(params => writeMonth(params, next))
  }

  // ─── Derivate ───────────────────────────────────────────────────────────────

  const owners: OwnerOption[] = useMemo(() => {
    if (!payload) return []
    const map = new Map<string, string>()
    for (const event of payload.events) {
      if (event.assignee_id) map.set(event.assignee_id, event.assignee_name || 'Fără nume')
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ro'))
  }, [payload])

  const visible: CalendarEvent[] = useMemo(
    () => (payload && filters ? filterEvents(payload.events, filters) : []),
    [payload, filters]
  )

  const overdueCount = useMemo(
    () => visible.filter(event => eventProgress(event) === 'overdue').length,
    [visible]
  )

  const inMonthCount = useMemo(() => {
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    return visible.filter(event => deadlineKey(event.deadline_at)?.startsWith(prefix)).length
  }, [visible, month])

  const dayEvents = useMemo(
    () => (openDayKey ? visible.filter(event => deadlineKey(event.deadline_at) === openDayKey) : []),
    [visible, openDayKey]
  )

  // ─── Stări de excepție ──────────────────────────────────────────────────────

  if (loading || !payload || !filters || !defaults) {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-[var(--p-danger)]" />
          <p className="text-sm font-semibold text-[var(--p-ink)]">{error}</p>
          <button
            type="button"
            onClick={load}
            className="rounded-lg bg-[var(--p-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Reîncearcă
          </button>
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-[var(--p-ink-faint)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Se încarcă termenele...
      </div>
    )
  }

  const today = new Date()
  const isCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()
  const hasAnyEvent = payload.events.length > 0
  const hiddenByFilters = hasAnyEvent && visible.length === 0

  return (
    <div className="space-y-3">
      {/* ── Bara de vedere ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {viewMode === 'month' && (
            <>
              <button
                type="button"
                onClick={() => changeMonth(addMonths(month, -1))}
                aria-label="Luna anterioară"
                className="rounded-lg p-1.5 text-[var(--p-ink-soft)] transition-colors hover:bg-[var(--p-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="min-w-[9rem] text-center font-display text-sm font-semibold capitalize text-[var(--p-ink)]" aria-live="polite">
                {formatMonthTitle(month)}
              </h2>
              <button
                type="button"
                onClick={() => changeMonth(addMonths(month, 1))}
                aria-label="Luna următoare"
                className="rounded-lg p-1.5 text-[var(--p-ink-soft)] transition-colors hover:bg-[var(--p-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {!isCurrentMonth && (
                <button
                  type="button"
                  onClick={() => changeMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
                  className="ml-1 rounded-full border border-[var(--p-border-strong)] px-2.5 py-1 text-xs font-semibold text-[var(--p-ink-soft)] transition-colors hover:bg-[var(--p-surface-2)]"
                >
                  Azi
                </button>
              )}
            </>
          )}
          {viewMode === 'list' && (
            <p className="text-sm font-semibold text-[var(--p-ink)]">
              {visible.length} {visible.length === 1 ? 'termen' : 'termene'}
              {overdueCount > 0 && (
                <span className="ml-2 text-xs font-bold text-[var(--p-danger)]">{overdueCount} depășite</span>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-[var(--p-border-strong)] bg-[var(--p-surface)] p-0.5">
          {([['month', 'Lună', CalendarDays], ['list', 'Listă', List]] as const).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              onClick={() => changeView(mode)}
              aria-pressed={viewMode === mode}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)] ${
                viewMode === mode ? 'bg-[var(--p-accent)] text-white' : 'text-[var(--p-ink-faint)] hover:bg-[var(--p-surface-2)]'
              }`}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filtre ── */}
      <CalendarFilters
        filters={filters}
        defaults={defaults}
        onChange={changeFilters}
        role={payload.role}
        userId={payload.user_id}
        scope={scope}
        phases={payload.phases}
        projects={payload.projects}
        owners={owners}
      />

      {/* ── Conținut ── */}
      {!hasAnyEvent ? (
        <EmptyState
          title={scope === 'project' ? 'Niciun termen în acest proiect' : 'Niciun termen în proiectele tale'}
          description="Termenele se completează din fișa activității sau a cererii de document. Pe măsură ce se publică elemente, ele apar aici."
        />
      ) : hiddenByFilters ? (
        <EmptyState
          title="Niciun termen pentru filtrele alese"
          description="Lărgește filtrele sau șterge-le, ca să vezi din nou toate termenele accesibile."
          action={
            <button
              type="button"
              onClick={() => changeFilters(defaults)}
              className="rounded-lg bg-[var(--p-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              Șterge filtrele
            </button>
          }
        />
      ) : viewMode === 'month' ? (
        <>
          <CalendarMonthGrid
            month={month}
            events={visible}
            withProject={scope === 'global'}
            onOpenDay={setOpenDayKey}
          />
          {inMonthCount === 0 && (
            <p className="px-1 text-xs text-[var(--p-ink-faint)]">
              Nicio zi cu termen în {formatMonthTitle(month)}. Restul de {visible.length}{' '}
              {visible.length === 1 ? 'termen se află' : 'termene se află'} în alte luni sau fără dată — vezi vederea Listă.
            </p>
          )}
        </>
      ) : (
        <DeadlineList events={visible} withProject={scope === 'global'} />
      )}

      <CalendarDayDialog
        dayKey={openDayKey}
        events={dayEvents}
        withProject={scope === 'global'}
        onClose={() => setOpenDayKey(null)}
      />
    </div>
  )
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--p-border-strong)] px-6 py-12 text-center">
      <CalendarDays className="h-8 w-8 text-[var(--p-ink-faint)]" aria-hidden />
      <h3 className="font-display text-base font-semibold text-[var(--p-ink)]">{title}</h3>
      <p className="max-w-sm text-sm text-[var(--p-ink-soft)]">{description}</p>
      {action}
    </div>
  )
}
