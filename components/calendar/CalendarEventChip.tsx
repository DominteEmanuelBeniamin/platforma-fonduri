'use client'

import Link from 'next/link'
import { eventProgress, type CalendarEvent } from '@/lib/calendar'
import { KIND_ICONS, eventAriaLabel, eventSurfaceStyle } from '@/components/calendar/eventVisuals'

interface CalendarEventChipProps {
  event: CalendarEvent
  /** În calendarul general, titlul proiectului intră în eticheta accesibilă. */
  withProject?: boolean
}

/**
 * Eveniment în grila de lună. Selectarea lui duce în pagina proiectului, pe
 * deep-linkul elementului — calendarul e o suprafață de citire, nu de editare.
 */
export default function CalendarEventChip({ event, withProject }: CalendarEventChipProps) {
  const progress = eventProgress(event)
  const Icon = KIND_ICONS[event.kind]
  const label = eventAriaLabel(event, progress, { withProject })

  return (
    <Link
      href={event.href}
      title={label}
      aria-label={label}
      style={eventSurfaceStyle(event, progress)}
      className="flex w-full items-center gap-1 rounded-md border-2 px-1.5 py-0.5 text-[11px] font-semibold leading-tight transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)] focus-visible:ring-offset-1"
    >
      <Icon className="h-2.5 w-2.5 flex-shrink-0" aria-hidden />
      <span className={`truncate ${progress === 'done' ? 'line-through opacity-75' : ''}`}>
        {event.name}
      </span>
    </Link>
  )
}
