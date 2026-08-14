import type { ReminderType } from './document-reminder'

export type ReminderLogSource = 'cron' | 'manual' | 'legacy'
export type ReminderLogStatus = 'claimed' | 'sent' | 'skipped'

export interface ReminderThresholdState {
  threshold: ReminderType
  status: ReminderLogStatus
  source: ReminderLogSource
  sent_at: string | null
  created_at: string
  reminder_log_id: string
}

export interface ReminderRecipientSummary {
  sent: number
  total: number
  claimed: number
  skipped: number
}

export interface ReminderEntityState {
  entity_type: 'request' | 'activity'
  entity_id: string
  deadline_at: string | null
  days_remaining: number | null
  current_threshold: ReminderType | null
  consumed_thresholds: ReminderType[]
  thresholds: Partial<Record<ReminderType, ReminderThresholdState>>
  last_sent: ReminderThresholdState | null
  recipient_summary?: ReminderRecipientSummary
}

export type ReminderStateMap = Record<string, ReminderEntityState>
