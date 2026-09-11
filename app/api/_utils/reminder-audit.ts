import type { createSupabaseServiceClient } from './supabase'
import type { ReminderCandidate } from '@/lib/deadline-reminder-candidates'
import { auditRow } from './audit.ts'

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
    const { error } = await admin.from('audit_logs').insert(auditRow({
      actorId: null,
      actionType: 'deadline_reminder_digest',
      entityType: 'deadline_reminder_digest',
      entityId: input.recipientId,
      entityName: `${input.recipientKind} reminder digest`,
      oldValues: null,
      newValues: {
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
          threshold: item.threshold,
          deadline_at: item.deadlineAt,
        })),
      },
      description: `Digest reminder ${input.recipientKind} cu ${input.items.length} elemente`,
      ipAddress: 'system',
      userAgent: 'deadline-reminder-cron',
    }))
    return error ?? null
  } catch (error) {
    return error
  }
}
