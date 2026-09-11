import { isMissingObjectError } from './attachment-storage'
import type { createSupabaseServiceClient } from './supabase'

type AdminClient = ReturnType<typeof createSupabaseServiceClient>

export const DATA_RETENTION_LEASE = 'data-retention'
export const DATA_RETENTION_BATCH_SIZE = 25
export const DATA_RETENTION_DUE_JOB_LIMIT = 100

export type RetentionPolicyRow = {
  policy_key: string
  enabled: boolean | null
  retention_hours: number | string | null
}

export type UploadBatchRow = {
  id: string
  requirement_id: string
  uploaded_by: string
  expected_files: unknown
  created_at: string
}

function firstRow<T>(data: T | T[] | null) {
  return Array.isArray(data) ? data[0] ?? null : data
}

export function retentionHoursToMilliseconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (!['number', 'string', 'bigint'].includes(typeof value)) return null
  const hours = Number(value)
  if (!Number.isSafeInteger(hours) || hours <= 0) return null
  return hours * 60 * 60 * 1000 <= Number.MAX_SAFE_INTEGER
    ? hours * 60 * 60 * 1000
    : null
}

export function uploadBatchStoragePrefix(projectId: string, requirementId: string, batchId: string) {
  return `projects/${projectId}/document-requests/${requirementId}/batches/${batchId}/`
}

export function expectedUploadStoragePaths(value: unknown, prefix: string): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null

  const paths: string[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const path = (item as { storage_path?: unknown }).storage_path
    if (
      typeof path !== 'string' ||
      path.length <= prefix.length ||
      !path.startsWith(prefix) ||
      path.split('/').some(segment => segment === '..')
    ) return null
    paths.push(path)
  }

  return [...new Set(paths)]
}

export async function acquireDataRetentionLease(admin: AdminClient, ownerId: string) {
  const { data, error } = await admin.rpc('acquire_reminder_run_lease', {
    p_lease_name: DATA_RETENTION_LEASE,
    p_owner_id: ownerId,
    p_lease_seconds: 900,
  })
  const row = firstRow(data as { acquired: boolean; expires_at: string | null } | { acquired: boolean; expires_at: string | null }[] | null)
  return { acquired: Boolean(row?.acquired), expiresAt: row?.expires_at ?? null, error }
}

export async function releaseDataRetentionLease(admin: AdminClient, ownerId: string) {
  const { data, error } = await admin.rpc('release_reminder_run_lease', {
    p_lease_name: DATA_RETENTION_LEASE,
    p_owner_id: ownerId,
  })
  return { released: Boolean(data), error }
}

export function isMissingStorageObjectError(message: string | null | undefined) {
  return isMissingObjectError(message)
}
