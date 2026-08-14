'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { formatDayTitle, formatRelativeDeadline, type CalendarEvent } from '@/lib/calendar'
import DeadlineList from '@/components/calendar/DeadlineList'

interface CalendarDayDialogProps {
  /** Ziua deschisă, ca „YYYY-MM-DD". Null = dialogul e închis. */
  dayKey: string | null
  events: CalendarEvent[]
  withProject?: boolean
  onClose: () => void
}

/** Toate termenele unei zile — ce nu încape în celula grilei. */
export default function CalendarDayDialog({ dayKey, events, withProject, onClose }: CalendarDayDialogProps) {
  if (!dayKey) return null

  const date = new Date(`${dayKey}T00:00:00`)
  const relative = formatRelativeDeadline(date.toISOString())

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999999] bg-slate-900/50 backdrop-blur-sm" />
        <Dialog.Content className="project-scope fixed left-1/2 top-[12vh] z-[999999] flex max-h-[70vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-[var(--p-surface)] shadow-2xl focus:outline-none">
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-[var(--p-border)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate font-display text-sm font-semibold text-[var(--p-ink)]">
                {formatDayTitle(date)}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[11px] text-[var(--p-ink-faint)]">
                {events.length} {events.length === 1 ? 'termen' : 'termene'}
                {relative ? ` · ${relative}` : ''}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Închide"
                className="flex-shrink-0 rounded-lg p-1 text-[var(--p-ink-faint)] transition-colors hover:bg-[var(--p-surface-2)] hover:text-[var(--p-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto">
            <DeadlineList events={events} grouped={false} withProject={withProject} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
