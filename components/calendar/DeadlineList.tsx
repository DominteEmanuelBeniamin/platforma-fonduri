'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { CalendarOff } from 'lucide-react'
import {
  PROGRESS_LABELS,
  VISIBILITY_LABELS,
  deadlineKey,
  eventProgress,
  formatDayTitle,
  formatRelativeDeadline,
  type CalendarEvent,
} from '@/lib/calendar'
import { KIND_ICONS, compareEvents, eventAriaLabel, eventSurfaceStyle } from '@/components/calendar/eventVisuals'

interface DeadlineListProps {
  events: CalendarEvent[]
  /** Grupare pe zile, cu antet de dată. Oprită în dialogul unei singure zile. */
  grouped?: boolean
  /** Afișează proiectul pe fiecare rând — necesar în calendarul general. */
  withProject?: boolean
  emptyMessage?: string
}

const CONTEXT_SEPARATOR = ' / '

function contextLabel(event: CalendarEvent): string {
  if (!event.phase_name) return 'Cereri generale'
  if (event.kind === 'request' && event.activity_name) {
    return event.phase_name + CONTEXT_SEPARATOR + event.activity_name
  }
  return event.phase_name
}

/**
 * Termenele ca listă, crescător după dată, cu grupul „Fără termen" la final.
 *
 * Componentă de sine stătătoare, cu evenimentele primite deja filtrate:
 * ecranul centralizat de taskuri (cerința 24) o refolosește ca atare.
 */
export default function DeadlineList({
  events,
  grouped = true,
  withProject = false,
  emptyMessage = 'Niciun termen de afișat.',
}: DeadlineListProps) {
  // O singură trecere prin evenimente, memoizată: componenta se re-randează la
  // fiecare filtru comutat și la fiecare deschidere de zi.
  const { dated, undated, days } = useMemo(() => {
    const withDeadline: CalendarEvent[] = []
    const withoutDeadline: CalendarEvent[] = []
    const byDay = new Map<string, CalendarEvent[]>()

    for (const event of events) {
      const key = deadlineKey(event.deadline_at)
      if (key === null) {
        withoutDeadline.push(event)
        continue
      }
      withDeadline.push(event)
      const bucket = byDay.get(key)
      if (bucket) bucket.push(event)
      else byDay.set(key, [event])
    }

    const buckets = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [, bucket] of buckets) bucket.sort(compareEvents)

    return {
      dated: [...withDeadline].sort(compareEvents),
      undated: withoutDeadline.sort(compareEvents),
      days: buckets,
    }
  }, [events])

  if (events.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-[var(--p-ink-faint)]">{emptyMessage}</p>
  }

  const rows = (list: CalendarEvent[]) => (
    <ul className="divide-y divide-[var(--p-border)]">
      {list.map(event => <EventRow key={`${event.kind}-${event.id}`} event={event} withProject={withProject} />)}
    </ul>
  )

  if (!grouped) return rows([...dated, ...undated])

  return (
    <div className="space-y-4">
      {days.map(([key, bucket]) => {
        const date = new Date(`${key}T00:00:00`)
        const relative = formatRelativeDeadline(bucket[0].deadline_at)
        const hasOverdue = bucket.some(event => eventProgress(event) === 'overdue')
        return (
          <section key={key} aria-label={formatDayTitle(date)}>
            <h3 className="flex items-baseline gap-2 px-1 pb-1.5 text-xs font-bold uppercase tracking-wide">
              <span className={hasOverdue ? 'text-[var(--p-danger)]' : 'text-[var(--p-ink-soft)]'}>
                {formatDayTitle(date)}
              </span>
              {relative && <span className="text-[11px] font-medium normal-case text-[var(--p-ink-faint)]">{relative}</span>}
            </h3>
            <div className="overflow-hidden rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)]">
              {rows(bucket)}
            </div>
          </section>
        )
      })}

      {undated.length > 0 && (
        // Ultimul grup, pliat: în proiectele aflate la început aproape totul e
        // fără termen, iar deschis ar îneca zilele care contează.
        <details className="overflow-hidden rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)]">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--p-ink-soft)] hover:bg-[var(--p-surface-2)]">
            <CalendarOff className="h-4 w-4 flex-shrink-0" aria-hidden />
            Fără termen
            <span className="rounded-full bg-[var(--p-surface-2)] px-2 py-0.5 text-[11px] font-bold text-[var(--p-ink-soft)]">
              {undated.length}
            </span>
          </summary>
          <div className="border-t border-[var(--p-border)]">{rows(undated)}</div>
        </details>
      )}
    </div>
  )
}

function EventRow({ event, withProject }: { event: CalendarEvent; withProject: boolean }) {
  const progress = eventProgress(event)
  const Icon = KIND_ICONS[event.kind]
  const label = eventAriaLabel(event, progress, { withProject })
  const relative = formatRelativeDeadline(event.deadline_at)

  return (
    <li>
      <Link
        href={event.href}
        aria-label={label}
        className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--p-surface-2)] focus:outline-none focus-visible:bg-[var(--p-surface-2)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--p-accent,#4A3F7A)]"
      >
        {/* Insigna poartă trei canale deodată: fundalul persoanei, iconița de
            tip și conturul (întrerupt pentru „În pregătire", roșu la depășire). */}
        <span
          style={eventSurfaceStyle(event, progress)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border-2"
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>

        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold text-[var(--p-ink)] ${progress === 'done' ? 'line-through opacity-70' : ''}`}>
            {event.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-[var(--p-ink-faint)]">
            {withProject && <span className="font-medium text-[var(--p-ink-soft)]">{event.project_title} · </span>}
            {contextLabel(event)}
            {event.assignee_name ? ` · ${event.assignee_name}` : ' · fără responsabil'}
          </span>
        </span>

        <span className="flex flex-shrink-0 items-center gap-1.5">
          {event.visibility === 'draft' && (
            <span className="hidden rounded-md border border-dashed border-[var(--p-draft,#6E6A85)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--p-draft,#6E6A85)] sm:inline">
              {VISIBILITY_LABELS.draft}
            </span>
          )}
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
              progress === 'overdue'
                ? 'bg-[var(--p-danger-soft)] text-[var(--p-danger)]'
                : progress === 'done'
                ? 'bg-[var(--p-success-soft)] text-[var(--p-success)]'
                : 'bg-[var(--p-surface-2)] text-[var(--p-ink-soft)]'
            }`}
          >
            {PROGRESS_LABELS[progress]}
          </span>
          {relative && (
            <span className="hidden w-20 text-right text-[11px] font-medium text-[var(--p-ink-faint)] sm:block">
              {relative}
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}
