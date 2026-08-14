import type { createSupabaseServiceClient } from './supabase'
import type { ReminderCandidate } from '@/lib/deadline-reminder-candidates'

type AdminClient = ReturnType<typeof createSupabaseServiceClient>

export async function logReminderDigestAudit(
  admin: AdminClient,
  input: {
    runId: string
    providerId: string | null
    recipientId: string
    recipientEmail: string
    recipientKind: 'client' | 'consultant'
    deliveryOverridden: boolean
    items: ReminderCandidate[]
  },
) {
  try {
    const { error } = await admin.from('audit_logs').insert({
      user_id: null,
      action_type: 'deadline_reminder_digest',
      entity_type: 'deadline_reminder_digest',
      entity_id: input.recipientId,
      entity_name: `${input.recipientKind} reminder digest`,
      old_values: null,
      new_values: {
        run_id: input.runId,
        provider_id: input.providerId,
        recipient_id: input.recipientId,
        recipient_email: input.recipientEmail,
        recipient_kind: input.recipientKind,
        delivery_overridden: input.deliveryOverridden,
        items: input.items.map(item => ({
          entity_type: item.entityType,
          entity_id: item.entityId,
          project_id: item.projectId,
          name: item.name,
          threshold: item.threshold,
          deadline_at: item.deadlineAt,
        })),
      },
      description: `Digest reminder ${input.recipientKind} cu ${input.items.length} elemente`,
      ip_address: 'system',
      user_agent: 'deadline-reminder-cron',
    })
    return error ?? null
  } catch (error) {
    return error
  }
}
