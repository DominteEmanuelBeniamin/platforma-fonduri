import type { createSupabaseServiceClient } from './supabase'

type AdminClient = ReturnType<typeof createSupabaseServiceClient>

export const DEADLINE_REMINDER_LEASE = 'deadline-reminders'

function firstRow<T>(data: T | T[] | null) {
  return Array.isArray(data) ? data[0] ?? null : data
}

export async function acquireReminderRunLease(admin: AdminClient, ownerId: string) {
  const { data, error } = await admin.rpc('acquire_reminder_run_lease', {
    p_lease_name: DEADLINE_REMINDER_LEASE,
    p_owner_id: ownerId,
    p_lease_seconds: 900,
  })
  const row = firstRow(data as { acquired: boolean; expires_at: string | null } | { acquired: boolean; expires_at: string | null }[] | null)
  return {
    acquired: Boolean(row?.acquired),
    expiresAt: row?.expires_at ?? null,
    error,
  }
}

export async function releaseReminderRunLease(admin: AdminClient, ownerId: string) {
  const { data, error } = await admin.rpc('release_reminder_run_lease', {
    p_lease_name: DEADLINE_REMINDER_LEASE,
    p_owner_id: ownerId,
  })
  return { released: Boolean(data), error }
}
