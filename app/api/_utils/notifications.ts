/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  buildNotificationEventKey,
  isUuid,
  selectEligibleNotificationRecipients,
  type NotificationRecipientProfile,
  type NotificationSeverity,
} from '@/lib/notification-utils'

export { buildNotificationEventKey }

export type NotificationType = 'publication' | 'assignment' | 'deadline' | 'document_action'
export type NotificationEntityType = 'project' | 'phase' | 'activity' | 'document_request'
export type { NotificationSeverity }

export type RecordNotificationInput = {
  projectId: string
  type: NotificationType
  entityType: NotificationEntityType
  entityId: string
  title: string
  /** Drives the icon and the colour in the bell. Stored, never re-derived from the title. */
  severity?: NotificationSeverity
  /** Whoever caused the event. Resolved to a display name once, at write time. */
  actorId?: string | null
  /** The name of the thing the notification is about. Looked up when omitted. */
  entityLabel?: string | null
  itemCount?: number
  eventKey?: string | null
  recipientIds?: string[]
  includeAdmins?: boolean
  fallbackToProjectMembers?: boolean
}

type NotificationProject = { id: string; client_id: string | null }

function dbError(error: any, operation: string): never {
  throw new Error(`${operation}: ${error?.message ?? String(error)}`)
}

async function loadProject(admin: any, projectId: string) {
  const result = await admin
    .from('projects')
    .select('id, client_id')
    .eq('id', projectId)
    .maybeSingle()

  if (result.error) dbError(result.error, 'Failed to load notification project')
  if (!result.data) throw new Error('Notification project not found')
  return result.data as NotificationProject
}

async function loadProfiles(admin: any, ids: string[]): Promise<NotificationRecipientProfile[]> {
  if (ids.length === 0) return []

  const result = await admin
    .from('profiles')
    .select('id, role, is_active')
    .in('id', ids)

  if (result.error) dbError(result.error, 'Failed to load notification recipients')
  return (result.data ?? []) as NotificationRecipientProfile[]
}

/**
 * The name is denormalised on purpose. The panel reads notifications with the
 * user's own client, and `profiles` is not readable through it, so a join would
 * come back empty; a row also stays truthful about who acted when that person
 * is later renamed or deactivated.
 */
async function resolveActorName(admin: any, actorId: string | null | undefined): Promise<string | null> {
  if (!actorId || !isUuid(actorId)) return null

  const result = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', actorId)
    .maybeSingle()

  if (result.error) dbError(result.error, 'Failed to load notification actor')
  const fullName = typeof result.data?.full_name === 'string' ? result.data.full_name.trim() : ''
  const email = typeof result.data?.email === 'string' ? result.data.email.trim() : ''
  return fullName || email || null
}

const ENTITY_LABEL_SOURCES: Record<string, string> = {
  phase: 'project_phases',
  activity: 'project_activities',
  document_request: 'document_requirements',
}

/**
 * A digest points at the project, and the project title is already on the row —
 * repeating it as the subject would say nothing. Mirrors
 * `public.notification_entity_label`, which does this for the SQL producers.
 */
async function resolveEntityLabel(
  admin: any,
  entityType: NotificationEntityType,
  entityId: string,
): Promise<string | null> {
  const table = ENTITY_LABEL_SOURCES[entityType]
  if (!table) return null

  const result = await admin.from(table).select('name').eq('id', entityId).maybeSingle()
  if (result.error) dbError(result.error, 'Failed to load notification entity label')
  const name = typeof result.data?.name === 'string' ? result.data.name.trim() : ''
  return name || null
}
export async function resolveNotificationRecipients(
  admin: any,
  input: Pick<RecordNotificationInput, 'projectId' | 'recipientIds' | 'includeAdmins' | 'fallbackToProjectMembers'>,
  project?: NotificationProject,
): Promise<string[]> {
  const currentProject = project ?? await loadProject(admin, input.projectId)
  const explicitIds = [...new Set((input.recipientIds ?? []).filter(Boolean))]
  const memberQuery = admin
    .from('project_members')
    .select('consultant_id')
    .eq('project_id', input.projectId)
  const members = explicitIds.length === 0 && input.fallbackToProjectMembers
    ? await memberQuery
    : explicitIds.length > 0
      ? await memberQuery.in('consultant_id', explicitIds)
      : { data: [], error: null }

  if (members.error) dbError(members.error, 'Failed to load notification project members')
  const memberIds: string[] = [...new Set<string>(
    (members.data ?? [])
      .map((member: any): string | null => typeof member.consultant_id === 'string' && member.consultant_id.length > 0
        ? member.consultant_id
        : null)
      .filter((id: string | null): id is string => id !== null),
  )]
  const profiles = await loadProfiles(admin, [...new Set([...explicitIds, ...memberIds])])
  let adminIds: string[] = []
  let adminProfiles: NotificationRecipientProfile[] = []
  if (input.includeAdmins !== false) {
    const admins = await admin
      .from('profiles')
      .select('id, role, is_active')
      .eq('role', 'admin')
      .eq('is_active', true)

    if (admins.error) dbError(admins.error, 'Failed to load notification admins')
    adminProfiles = (admins.data ?? []) as NotificationRecipientProfile[]
    adminIds = adminProfiles.map(profile => profile.id)
  }

  return selectEligibleNotificationRecipients({
    projectClientId: currentProject.client_id,
    profiles: [...profiles, ...adminProfiles],
    memberIds,
    requestedIds: explicitIds,
    adminIds,
    includeAdmins: input.includeAdmins,
    fallbackToProjectMembers: input.fallbackToProjectMembers,
  })
}

export async function recordNotification(admin: any, input: RecordNotificationInput) {
  const title = input.title.trim()
  const itemCount = input.itemCount ?? 1
  if (!title) throw new Error('Notification title is required')
  if (!Number.isInteger(itemCount) || itemCount < 1) {
    throw new Error('Notification itemCount must be a positive integer')
  }

  const severity = input.severity ?? 'info'
  const project = await loadProject(admin, input.projectId)
  const recipientIds = await resolveNotificationRecipients(admin, input, project)
  const eventKey = buildNotificationEventKey(input)

  if (recipientIds.length === 0) return { recipientIds, inserted: 0, insertedIds: [] as string[], eventKey }

  const actorName = await resolveActorName(admin, input.actorId)
  const entityLabel = input.entityLabel === undefined
    ? await resolveEntityLabel(admin, input.entityType, input.entityId)
    : input.entityLabel?.trim() || null
  const result = await admin
    .from('notifications')
    .upsert(
      recipientIds.map(userId => ({
        user_id: userId,
        project_id: input.projectId,
        type: input.type,
        entity_type: input.entityType,
        entity_id: input.entityId,
        title,
        severity,
        actor_name: actorName,
        entity_label: entityLabel,
        item_count: itemCount,
        event_key: eventKey,
      })),
      { onConflict: 'user_id,event_key', ignoreDuplicates: true },
    )
    .select('id')

  if (result.error) dbError(result.error, 'Failed to record notification')
  const insertedIds = (result.data ?? [])
    .map((row: any) => row?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && isUuid(id))
  return { recipientIds, inserted: insertedIds.length, insertedIds, eventKey }
}

/** Delete only rows inserted by the current attempt. The caller must pass a service-role client. */
export async function deleteNotificationsByIds(admin: any, ids: readonly string[]) {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return { deleted: 0 }
  if (uniqueIds.some(id => !isUuid(id))) {
    throw new Error('Notification ids must be UUIDs')
  }

  // `.select()` so the count is what Postgres actually removed: a compensation
  // that deleted nothing must not read like one that deleted everything in the
  // logs written for manual repair.
  const result = await admin.from('notifications').delete().in('id', uniqueIds).select('id')
  if (result.error) dbError(result.error, 'Failed to delete notification compensation rows')
  return { deleted: (result.data ?? []).length }
}
