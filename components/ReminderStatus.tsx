import { Mail } from 'lucide-react'
import type { ReminderType } from '@/lib/document-reminder'
import type { ReminderEntityState } from '@/lib/reminder-state'

export type ReminderDisplayStatus = 'sent' | 'skipped' | 'claimed' | 'available'

export function getReminderDisplayStatus(
  state: ReminderEntityState | undefined,
  threshold: ReminderType | null,
): ReminderDisplayStatus {
  return threshold && state?.thresholds[threshold]?.status
    ? state.thresholds[threshold].status
    : 'available'
}

export default function ReminderStatus({
  state,
}: {
  state?: ReminderEntityState
}) {
  const lastSent = state?.last_sent
  if (!lastSent) return null
  const sentAt = new Date(lastSent.sent_at ?? lastSent.created_at)

  return (
    <div className="flex items-center gap-2 text-sm text-slate-600" title={sentAt.toLocaleString('ro-RO')}>
      <Mail className="w-4 h-4 flex-shrink-0 text-slate-400" />
      <span>Ultimul reminder trimis: <strong>{sentAt.toLocaleDateString('ro-RO')}, {sentAt.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}</strong></span>
    </div>
  )
}
