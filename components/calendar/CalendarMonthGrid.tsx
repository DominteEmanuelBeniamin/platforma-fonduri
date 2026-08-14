'use client'

import { useMemo } from 'react'
import {
  WEEKDAY_LABELS,
  dateKey,
  deadlineKey,
  eventProgress,
  formatDayTitle,
  monthGridDays,
  type CalendarEvent,
} from '@/lib/calendar'
import { ownerColor, sortEvents } from '@/components/calendar/eventVisuals'
import CalendarEventChip from '@/components/calendar/CalendarEventChip'

interface CalendarMonthGridProps {
  month: Date
  /** Evenimente deja filtrate; cele fără termen nu au unde să cadă în grilă. */
  events: CalendarEvent[]
  withProject?: boolean
  onOpenDay: (dayKey: string) => void
}

/** Câte evenimente încap într-o celulă înainte de indicatorul „+N". */
const VISIBLE_PER_DAY = 3

/**
 * Grila de lună, scrisă de mână: termenele sunt date fără oră, deci luna
 * înseamnă 42 de celule și aritmetică de zile. O bibliotecă de calendar ar fi
 * adus vederi orare, greutate și un sistem de stiluri paralel cu Tailwind.
 */
export default function CalendarMonthGrid({ month, events, withProject, onOpenDay }: CalendarMonthGridProps) {
  const days = useMemo(() => monthGridDays(month), [month])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const key = deadlineKey(event.deadline_at)
      if (!key) continue
      const bucket = map.get(key)
      if (bucket) bucket.push(event)
      else map.set(key, [event])
    }
    for (const [key, bucket] of map) map.set(key, sortEvents(bucket))
    return map
  }, [events])

  const todayKey = dateKey(new Date())

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)]">
      <div className="grid grid-cols-7 border-b border-[var(--p-border)] bg-[var(--p-surface-2)]">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="px-1 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-[var(--p-ink-faint)]">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map(day => {
          const key = dateKey(day)
          const dayEvents = byDay.get(key) ?? []
          const inMonth = day.getMonth() === month.getMonth()
          const isToday = key === todayKey
          const hidden = Math.max(0, dayEvents.length - VISIBLE_PER_DAY)

          return (
            <div
              key={key}
              className={`flex min-h-[4.5rem] flex-col gap-1 border-b border-r border-[var(--p-border)] p-1 sm:min-h-[7rem] ${
                inMonth ? '' : 'bg-[var(--p-surface-2)]/50'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                {dayEvents.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenDay(key)}
                    aria-label={`${formatDayTitle(day)} — ${dayEvents.length} ${dayEvents.length === 1 ? 'termen' : 'termene'}`}
                    className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)] ${
                      isToday
                        ? 'bg-[var(--p-accent)] text-white'
                        : inMonth
                        ? 'text-[var(--p-ink)] hover:bg-[var(--p-surface-2)]'
                        : 'text-[var(--p-ink-faint)] hover:bg-[var(--p-surface-2)]'
                    }`}
                  >
                    {day.getDate()}
                  </button>
                ) : (
                  <span
                    className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                      isToday
                        ? 'bg-[var(--p-accent)] text-white'
                        : inMonth
                        ? 'text-[var(--p-ink-soft)]'
                        : 'text-[var(--p-ink-faint)]'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                )}

                {/* Pe telefon celula e prea îngustă pentru etichete: rămân
                    bulinele, iar numărul zilei deschide lista zilei. */}
                {dayEvents.length > 0 && (
                  <span className="flex items-center gap-0.5 sm:hidden" aria-hidden>
                    {dayEvents.slice(0, VISIBLE_PER_DAY).map(event => {
                      const color = ownerColor(event)
                      return (
                        <span
                          key={`${event.kind}-${event.id}`}
                          className={`h-1.5 w-1.5 rounded-full ${
                            eventProgress(event) === 'overdue' ? 'ring-1 ring-[var(--p-danger)]' : ''
                          }`}
                          style={{ backgroundColor: color.from }}
                        />
                      )
                    })}
                    {hidden > 0 && (
                      <span className="text-[9px] font-bold text-[var(--p-ink-faint)]">+{hidden}</span>
                    )}
                  </span>
                )}
              </div>

              <div className="hidden flex-1 flex-col gap-0.5 sm:flex">
                {dayEvents.slice(0, VISIBLE_PER_DAY).map(event => (
                  <CalendarEventChip key={`${event.kind}-${event.id}`} event={event} withProject={withProject} />
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenDay(key)}
                    className="rounded-md px-1.5 py-0.5 text-left text-[11px] font-bold text-[var(--p-accent)] hover:bg-[var(--p-accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent,#4A3F7A)]"
                    aria-label={`Încă ${hidden} ${hidden === 1 ? 'termen' : 'termene'} pe ${formatDayTitle(day)}`}
                  >
                    +{hidden}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
