'use client'

import Link from 'next/link'
import {
  PROGRESS_LABELS,
  VISIBILITY_LABELS,
  eventProgress,
  formatRelativeDeadline,
  type CalendarEvent,
} from '@/lib/calendar'
import { KIND_ICONS, eventAriaLabel, eventSurfaceStyle } from '@/components/calendar/eventVisuals'

const CONTEXT_SEPARATOR = ' / '

function contextLabel(event: CalendarEvent): string {
  if (!event.phase_name) return 'Cereri generale'
  if (event.kind === 'request' && event.activity_name) {
    return event.phase_name + CONTEXT_SEPARATOR + event.activity_name
  }
  return event.phase_name
}

/**
 * Un termen, ca rând de listă: insignă, nume, context, stare și cât mai e până
 * la el. Link direct către element, nu către proiect.
 *
 * Stă în fișierul lui fiindcă îl folosesc două ecrane — lista de termene a
 * calendarului și rândul desfășurat din tabloul de bord (#81). Două copii ale
 * aceluiași rând ar fi însemnat două convenții vizuale care se despart la prima
 * modificare făcută într-una singură.
 *
 * Trebuie randat într-un `<ul>`: rândul e un `<li>`.
 */
export default function EventRow({
  event,
  withProject = false,
}: {
  event: CalendarEvent
  /** Afișează proiectul pe rând — necesar oriunde lista amestecă mai multe. */
  withProject?: boolean
}) {
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
