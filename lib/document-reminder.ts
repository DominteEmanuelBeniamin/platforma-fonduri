export type ReminderType = '1_week' | '3_days' | '1_day' | 'same_day' | 'overdue'

export const REMINDER_TIME_ZONE = 'Europe/Bucharest'
export const REMINDER_TYPES: ReminderType[] = ['1_week', '3_days', '1_day', 'same_day', 'overdue']

function calendarDay(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))
}

export function getDaysUntilDeadline(
  deadlineAt: string | null,
  now = new Date(),
  timeZone = REMINDER_TIME_ZONE,
): number | null {
  if (!deadlineAt) return null
  const deadline = new Date(deadlineAt)
  if (Number.isNaN(deadline.getTime()) || Number.isNaN(now.getTime())) return null
  return Math.trunc((calendarDay(deadline, timeZone) - calendarDay(now, timeZone)) / 86_400_000)
}

export function sameReminderDeadline(left: string | null | undefined, right: string | null | undefined) {
  const leftTime = left ? Date.parse(left) : Number.NaN
  const rightTime = right ? Date.parse(right) : Number.NaN
  return Number.isFinite(leftTime) && leftTime === rightTime
}

export function getReminderType(
  deadlineAt: string | null,
  now = new Date(),
  timeZone = REMINDER_TIME_ZONE,
): ReminderType | null {
  const days = getDaysUntilDeadline(deadlineAt, now, timeZone)
  if (days === null) return null
  if (days < 0) return 'overdue'
  if (days === 0) return 'same_day'
  if (days <= 1) return '1_day'
  if (days <= 3) return '3_days'
  if (days <= 7) return '1_week'
  return null
}

export function getManualReminderType(
  deadlineAt: string | null,
  now = new Date(),
  timeZone = REMINDER_TIME_ZONE,
): ReminderType | null {
  if (getDaysUntilDeadline(deadlineAt, now, timeZone) === null) return null
  return getReminderType(deadlineAt, now, timeZone) ?? '1_week'
}

export const REMINDER_LABELS: Record<ReminderType, string> = {
  '1_week': 'Reminder 1 săptămână',
  '3_days': 'Reminder 3 zile',
  '1_day': 'Reminder mâine',
  'same_day': 'Reminder astăzi',
  overdue: 'Termen depășit',
}

export const REMINDER_BADGE: Record<ReminderType, { bg: string; text: string; border: string }> = {
  '1_week': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  '3_days': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  '1_day': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  same_day: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  overdue: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
}

export function formatDeadline(deadlineAt: string): string {
  return new Date(deadlineAt).toLocaleDateString('ro-RO', {
    timeZone: REMINDER_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
