/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  buildNotificationEventKey,
  selectEligibleNotificationRecipients,
  type NotificationRecipientProfile,
} from '@/lib/notification-utils'

export { buildNotificationEventKey }

export type NotificationType = 'publication' | 'assignment' | 'deadline' | 'document_action'
export type NotificationEntityType = 'project' | 'phase' | 'activity' | 'document_request'

export type RecordNotificationInput = {
  projectId: string
  type: NotificationType
  entityType: NotificationEntityType
  entityId: string
  title: string
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

  const project = await loadProject(admin, input.projectId)
  const recipientIds = await resolveNotificationRecipients(admin, input, project)
  const eventKey = buildNotificationEventKey(input)

  if (recipientIds.length === 0) return { recipientIds, inserted: 0, eventKey }

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
        item_count: itemCount,
        event_key: eventKey,
      })),
      { onConflict: 'user_id,event_key', ignoreDuplicates: true },
    )
    .select('id')

  if (result.error) dbError(result.error, 'Failed to record notification')
  return { recipientIds, inserted: (result.data ?? []).length, eventKey }
}
