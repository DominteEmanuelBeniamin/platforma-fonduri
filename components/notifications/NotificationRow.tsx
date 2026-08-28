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
  if (item.type === 'publication') return { Icon: Megaphone, iconClassName: 'bg-emerald-100 text-emerald-600' }
  if (item.type === 'assignment') return { Icon: UserRoundCheck, iconClassName: 'bg-indigo-100 text-indigo-600' }
  if (item.type === 'deadline') {
    return item.severity === 'danger'
      ? { Icon: AlertCircle, iconClassName: 'bg-red-100 text-red-600' }
      : { Icon: CalendarClock, iconClassName: 'bg-amber-100 text-amber-700' }
  }
  if (item.type === 'document_action') {
    if (item.severity === 'success') return { Icon: FileCheck, iconClassName: 'bg-emerald-100 text-emerald-600' }
    if (item.severity === 'danger') return { Icon: FileX, iconClassName: 'bg-red-100 text-red-600' }
    if (item.severity === 'info') return { Icon: Upload, iconClassName: 'bg-blue-100 text-blue-600' }
    return { Icon: FileText, iconClassName: 'bg-violet-100 text-violet-600' }
  }
  return { Icon: Bell, iconClassName: 'bg-slate-100 text-slate-500' }
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
        ? 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
        : 'border-violet-100 bg-violet-50/50 hover:border-violet-200 hover:bg-violet-50'}`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpen(item)}
        className={`flex min-w-0 flex-1 items-start gap-3 rounded-2xl px-3.5 py-3 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${hasActions ? '' : 'pr-3.5'}`}
      >
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-snug text-slate-800">
            {notificationSubject(item)}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500" title={formatNotificationDate(item.createdAt)}>
            {context.join(' · ')}
          </span>
        </span>
        {!item.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" aria-label="Necitită" />}
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
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
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
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
