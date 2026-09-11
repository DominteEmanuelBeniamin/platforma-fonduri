import {
  computePurgeDate,
  isRetentionPolicyEnabled,
  type RetentionPolicy,
} from '@/lib/data-retention'
import type { createSupabaseServiceClient } from './supabase'

type AdminClient = ReturnType<typeof createSupabaseServiceClient>

export type DeletionJobTargetType =
  | 'project'
  | 'document'
  | 'user'
  | 'project_chat_message'
  | 'private_message'
  | 'orphan_upload'

export type DeletionScheduleInput = {
  deletedAt: string | Date
  retentionUntilDates?: Array<string | Date | null | undefined>
  requireBusinessRetention?: boolean
  legalHoldAt?: string | Date | null
  policyKey?: string
  businessRetentionStartAt?: string | Date | null
}

export type QueueDeletionJobInput = {
  targetType: DeletionJobTargetType
  targetId: string
  executeAfter: string | Date
  requestedBy?: string | null
  reason: string
}

type RetentionPolicyRow = RetentionPolicy & { policy_key: string }

export async function loadEnabledRetentionPolicy(admin: AdminClient, policyKey: string) {
  const { data, error } = await admin
    .from('retention_policies')
    .select('policy_key, enabled, retention_hours')
    .eq('policy_key', policyKey)
    .maybeSingle()

  if (error) return { policy: null, error }
  const policy = data as RetentionPolicyRow | null
  return {
    policy: policy && isRetentionPolicyEnabled(policy) ? policy : null,
    error: null,
  }
}

export async function computeDeletionPurgeDate(
  admin: AdminClient,
  input: DeletionScheduleInput,
) {
  const grace = await loadEnabledRetentionPolicy(admin, 'soft_delete_grace')
  if (grace.error || !grace.policy) return { purgeAfter: null, error: grace.error }

  let businessRetentionHours: RetentionPolicy['retention_hours'] = null
  if (input.policyKey) {
    const specific = await loadEnabledRetentionPolicy(admin, input.policyKey)
    if (specific.error || !specific.policy) return { purgeAfter: null, error: specific.error }
    businessRetentionHours = specific.policy.retention_hours
  }

  return {
    purgeAfter: computePurgeDate({
      deletedAt: input.deletedAt,
      graceRetentionHours: grace.policy.retention_hours,
      retentionUntilDates: input.retentionUntilDates,
      requireBusinessRetention: input.requireBusinessRetention,
      legalHoldAt: input.legalHoldAt,
      businessRetentionStartAt: input.businessRetentionStartAt,
      businessRetentionHours: input.businessRetentionStartAt == null ? null : businessRetentionHours,
    }),
    error: null,
  }
}

export async function queueDeletionJob(admin: AdminClient, input: QueueDeletionJobInput) {
  const executeAfter = input.executeAfter instanceof Date
    ? input.executeAfter.toISOString()
    : input.executeAfter
  const { error } = await admin.from('data_deletion_jobs').insert({
    target_type: input.targetType,
    target_id: input.targetId,
    execute_after: executeAfter,
    status: 'queued',
    attempts: 0,
    last_error: null,
    requested_by: input.requestedBy ?? null,
    reason: input.reason,
  })

  if (!error) return { queued: true, alreadyQueued: false, error: null }
  if (error.code === '23505') return { queued: false, alreadyQueued: true, error: null }
  return { queued: false, alreadyQueued: false, error }
}
