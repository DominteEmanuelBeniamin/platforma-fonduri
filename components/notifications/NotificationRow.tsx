'use client'

import {
  AlertCircle,
  Bell,
  CalendarClock,
  Check,
  FileCheck,
  FileText,
  FileX,
  Megaphone,
  Trash2,
  Undo2,
  Upload,
  UserRoundCheck,
} from 'lucide-react'
import {
  formatNotificationDate,
  notificationContext,
  notificationSubject,
} from '@/lib/notification-display'
import type { NotificationItem } from '@/components/notifications/useNotificationFeed'

type NotificationVisual = {
  Icon: typeof Bell
  iconClassName: string
}

// Iconița și culoarea vin din `type` și `severity`, scrise odată cu
// notificarea. Deducerea lor din titlul în română lega aspectul de formularea
// exactă a patru producători fără legătură între ei.
function notificationVisual(item: NotificationItem): NotificationVisual {
  if (item.type === 'publication') return { Icon: Megaphone, iconClassName: 'bg-[var(--sg-ok-soft)] text-[var(--sg-ok)]' }
  if (item.type === 'assignment') return { Icon: UserRoundCheck, iconClassName: 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]' }
  if (item.type === 'deadline') {
    return item.severity === 'danger'
      ? { Icon: AlertCircle, iconClassName: 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]' }
      : { Icon: CalendarClock, iconClassName: 'bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]' }
  }
  if (item.type === 'document_action') {
    if (item.severity === 'success') return { Icon: FileCheck, iconClassName: 'bg-[var(--sg-ok-soft)] text-[var(--sg-ok)]' }
    if (item.severity === 'danger') return { Icon: FileX, iconClassName: 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]' }
    if (item.severity === 'info') return { Icon: Upload, iconClassName: 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]' }
    return { Icon: FileText, iconClassName: 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]' }
  }
  return { Icon: Bell, iconClassName: 'bg-paper-sunk text-ink-soft' }
}

type Props = {
  item: NotificationItem
  onOpen: (item: NotificationItem) => void
  disabled?: boolean
  /** Controalele per rând stau pe pagină; panoul rămâne o listă scurtă. */
  onToggleRead?: (item: NotificationItem) => void
  onDismiss?: (item: NotificationItem) => void
}

export default function NotificationRow({ item, onOpen, disabled, onToggleRead, onDismiss }: Props) {
  const { Icon, iconClassName } = notificationVisual(item)
  const context = notificationContext(item)
  const hasActions = !!onToggleRead || !!onDismiss

  return (
    <div
      className={`flex items-start gap-1 rounded-2xl border transition-colors ${item.readAt
        ? 'border-rule bg-white hover:border-rule hover:bg-paper-sunk'
        : 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)]'}`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpen(item)}
        className={`flex min-w-0 flex-1 items-start gap-3 rounded-2xl px-3.5 py-3 text-left focus:outline-none focus:ring-2 focus:ring-[var(--sg-accent)] ${hasActions ? '' : 'pr-3.5'}`}
      >
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-snug text-ink">
            {notificationSubject(item)}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-ink-soft" title={formatNotificationDate(item.createdAt)}>
            {context.join(' · ')}
          </span>
        </span>
        {!item.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--sg-accent)]" aria-label="Necitită" />}
      </button>

      {hasActions && (
        <div className="flex shrink-0 items-center gap-0.5 py-3 pr-2">
          {onToggleRead && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onToggleRead(item)}
              aria-label={item.readAt ? 'Marchează ca necitită' : 'Marchează ca citită'}
              title={item.readAt ? 'Marchează ca necitită' : 'Marchează ca citită'}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint hover:bg-white hover:text-[var(--sg-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--sg-accent)]"
            >
              {item.readAt ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-4 w-4" />}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDismiss(item)}
              aria-label="Șterge notificarea"
              title="Șterge notificarea"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint hover:bg-white hover:text-[var(--sg-danger)] focus:outline-none focus:ring-2 focus:ring-[var(--sg-danger)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
