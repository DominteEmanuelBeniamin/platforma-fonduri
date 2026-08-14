import type { ReminderType } from '@/lib/document-reminder'
import type { createSupabaseServiceClient } from './supabase'

type AdminClient = ReturnType<typeof createSupabaseServiceClient>

export interface ReminderClaimInput {
  entityType: 'request' | 'activity'
  entityId: string
  projectId: string
  recipientId: string
  recipientEmail: string
  recipientKind: 'client' | 'consultant'
  threshold: ReminderType
  deadlineAt: string
  source: 'cron' | 'manual'
  triggeredBy?: string | null
  runId?: string | null
}

export interface ReminderClaim {
  claimed: boolean
  logId: string | null
  sendIndex: number | null
  claimToken: string | null
  claimExpiresAt: string | null
  reason: string
}

export interface FinalizedReminderClaim {
  finalized: boolean
  skippedCount: number
}

type RawReminderClaim = {
  claimed: boolean
  log_id: string | null
  send_index: number | null
  claim_token: string | null
  claim_expires_at: string | null
  reason: string
}

function firstRow<T>(data: T | T[] | null) {
  return Array.isArray(data) ? data[0] ?? null : data
}

export async function claimReminder(admin: AdminClient, input: ReminderClaimInput): Promise<{
  data: ReminderClaim | null
  error: unknown
}> {
  const { data, error } = await admin.rpc('claim_reminder_slot', {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_project_id: input.projectId,
    p_recipient_id: input.recipientId,
    p_recipient_email: input.recipientEmail,
    p_recipient_kind: input.recipientKind,
    p_threshold: input.threshold,
    p_deadline_at: input.deadlineAt,
    p_source: input.source,
    p_triggered_by: input.triggeredBy ?? null,
    p_run_id: input.runId ?? null,
  })

  const row = firstRow(data as RawReminderClaim | RawReminderClaim[] | null)
  return {
    data: row
      ? {
          claimed: Boolean(row.claimed),
          logId: row.log_id ?? null,
          sendIndex: row.send_index ?? null,
          claimToken: row.claim_token ?? null,
          claimExpiresAt: row.claim_expires_at ?? null,
          reason: row.reason ?? '',
        }
      : null,
    error,
  }
}

export async function finalizeReminderClaim(
  admin: AdminClient,
  logId: string,
  claimToken: string,
  providerId: string | null,
) {
  const { data, error } = await admin.rpc('finalize_reminder_claim', {
    p_log_id: logId,
    p_claim_token: claimToken,
    p_provider_id: providerId,
  })
  const row = firstRow(data as { finalized: boolean; skipped_count: number } | { finalized: boolean; skipped_count: number }[] | null)
  return {
    data: row
      ? { finalized: Boolean(row.finalized), skippedCount: Number(row.skipped_count ?? 0) }
      : null,
    error,
  }
}

export async function releaseReminderClaim(admin: AdminClient, logId: string, claimToken: string) {
  return admin.rpc('release_reminder_claim', {
    p_log_id: logId,
    p_claim_token: claimToken,
  })
}
