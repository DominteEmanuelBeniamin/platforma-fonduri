import { Clock3, Loader2, Mail } from 'lucide-react'
import { REMINDER_BADGE, REMINDER_LABELS, type ReminderType } from '@/lib/document-reminder'
import type { ReminderEntityState, ReminderRecipientSummary } from '@/lib/reminder-state'

export type ReminderDisplayStatus = 'sent' | 'skipped' | 'claimed' | 'available'

export function getReminderDisplayStatus(
  state: ReminderEntityState | undefined,
  threshold: ReminderType | null,
): ReminderDisplayStatus {
  return threshold && state?.thresholds[threshold]?.status
    ? state.thresholds[threshold].status
    : 'available'
}

function statusLabel(status: ReminderDisplayStatus) {
  if (status === 'sent') return 'trimis'
  if (status === 'skipped') return 'prag consumat'
  if (status === 'claimed') return 'în curs'
  return 'disponibil'
}

function sourceLabel(source: string) {
  return source === 'cron' ? 'automat' : source === 'manual' ? 'manual' : source
}

function daysLabel(days: number | null) {
  if (days === null) return 'fără termen'
  if (days < 0) return `depășit cu ${Math.abs(days)} ${Math.abs(days) === 1 ? 'zi' : 'zile'}`
  return `${days} ${days === 1 ? 'zi' : 'zile'} rămase`
}

export default function ReminderStatus({
  state,
  threshold,
  loading = false,
  summary,
  compact = false,
}: {
  state?: ReminderEntityState
  threshold: ReminderType | null
  loading?: boolean
  summary?: ReminderRecipientSummary
  compact?: boolean
}) {
  if (loading) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Se încarcă starea…</span>
  }

  const status = getReminderDisplayStatus(state, threshold)
  const thresholdState = threshold ? state?.thresholds[threshold] : undefined
  const lastSent = state?.last_sent
  const badge = threshold ? REMINDER_BADGE[threshold] : null

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${compact ? '' : 'text-slate-500'}`}>
      <span className="inline-flex items-center gap-1.5">
        <Clock3 className="h-3 w-3 text-slate-400" />
        {daysLabel(state?.days_remaining ?? null)}
      </span>
      {threshold && badge && (
        <span className={`rounded-md border px-1.5 py-0.5 font-medium ${badge.bg} ${badge.text} ${badge.border}`}>
          {REMINDER_LABELS[threshold]}
        </span>
      )}
      <span className={`font-medium ${status === 'sent' ? 'text-emerald-600' : status === 'claimed' ? 'text-indigo-600' : status === 'skipped' ? 'text-slate-500' : 'text-amber-600'}`}>
        {statusLabel(status)}
      </span>
      {lastSent && (
        <span className="inline-flex items-center gap-1 text-slate-400" title={new Date(lastSent.sent_at ?? lastSent.created_at).toLocaleString('ro-RO')}>
          <Mail className="h-3 w-3" />
          Ultimul: {REMINDER_LABELS[lastSent.threshold]} · {sourceLabel(lastSent.source)} · {new Date(lastSent.sent_at ?? lastSent.created_at).toLocaleDateString('ro-RO')}
        </span>
      )}
      {summary && (
        <span className="text-slate-400">
          Destinatari: {summary.sent}/{summary.total} trimise{summary.claimed ? ` · ${summary.claimed} în curs` : ''}{summary.skipped ? ` · ${summary.skipped} consumate` : ''}
        </span>
      )}
      {thresholdState?.status === 'claimed' && <span className="sr-only">Reminderul este în curs de trimitere.</span>}
    </div>
  )
}
