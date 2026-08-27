import { createHash } from 'node:crypto'

export type NotificationEventParts = {
  projectId: string
  type: string
  entityType: string
  entityId: string
  eventKey?: string | null
}

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'danger'

export type NotificationCursor = {
  createdAt: string
  id: string
}

export type NotificationRecipientProfile = {
  id: string
  role?: 'admin' | 'consultant' | 'client' | string | null
  is_active?: boolean | null
}

export type NotificationRecipientSelection = {
  projectClientId: string | null | undefined
  profiles: NotificationRecipientProfile[]
  memberIds: string[]
  requestedIds?: string[]
  adminIds?: string[]
  includeAdmins?: boolean
  fallbackToProjectMembers?: boolean
}

export type NotificationEventItem = {
  entityType: string
  entityId: string
}

export type PublicationNotificationMetadata = {
  itemCount: number
  target: { entityType: 'project' | 'phase' | 'activity' | 'document_request'; entityId: string }
  eventKey: string
}

// Postgres accepts UUID variants beyond RFC 4122 versions (for example UUIDs
// produced by extensions); validate the canonical shape without narrowing it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function shouldReleaseClaimsAfterNotificationCleanup(
  insertedIds: readonly string[],
  cleanupSucceeded: boolean,
): boolean {
  return insertedIds.length === 0 || cleanupSucceeded
}

export function buildNotificationEventKey(parts: NotificationEventParts): string {
  const explicit = parts.eventKey?.trim()
  return explicit || `${parts.type}:${parts.projectId}:${parts.entityType}:${parts.entityId}`
}

export function canonicalNotificationItems(items: NotificationEventItem[]): NotificationEventItem[] {
  return [...items]
    .map(item => ({ entityType: item.entityType, entityId: item.entityId }))
    .sort((left, right) => {
      const a = `${left.entityType}:${left.entityId}`
      const b = `${right.entityType}:${right.entityId}`
      return a < b ? -1 : a > b ? 1 : 0
    })
}

function notificationMetadataHash(prefix: string, value: unknown): string {
  return `${prefix}-${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

export function buildPublicationNotificationMetadata(input: {
  projectId: string
  clientId: string
  items: NotificationEventItem[]
}): PublicationNotificationMetadata | null {
  const items = canonicalNotificationItems(input.items)
  if (items.length === 0) return null

  const target = items.length === 1
    ? items[0]
    : { entityType: 'project' as const, entityId: input.projectId }
  return {
    itemCount: items.length,
    target: target as PublicationNotificationMetadata['target'],
    eventKey: notificationMetadataHash('publication-v1', {
      projectId: input.projectId,
      clientId: input.clientId,
      items,
    }),
  }
}

export function buildPublicationEmailIdempotencyKey(input: {
  projectId: string
  clientId: string
  items: NotificationEventItem[]
}): string {
  return notificationMetadataHash('publication-email-v1', {
    projectId: input.projectId,
    clientId: input.clientId,
    items: canonicalNotificationItems(input.items),
  })
}

export function buildManualReminderNotificationMetadata(input: {
  projectId: string
  requestId: string
  recipientId: string
  threshold: string
  deadlineAt: string
  sendIndex: number
}) {
  const value = {
    projectId: input.projectId,
    requestId: input.requestId,
    recipientId: input.recipientId,
    threshold: input.threshold,
    deadlineAt: input.deadlineAt,
    sendIndex: input.sendIndex,
  }
  const hash = notificationMetadataHash('deadline-manual-v1', value)
  return { eventKey: hash, idempotencyKey: `${hash}-email` }
}

/**
 * Only the email needs a key from here. The in-app notification is written by
 * the assignment trigger, which builds its own event key from the transition it
 * sees — the two can never be made to agree, so this no longer pretends to.
 */
export function buildAssignmentEmailIdempotencyKey(input: {
  projectId: string
  entityType: 'activity' | 'document_request'
  entityId: string
  recipientId: string
  version: string | number
}): string {
  return notificationMetadataHash('assignment-email-v1', {
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    recipientId: input.recipientId,
    version: input.version,
  })
}

export function isRealAssignmentChange(previous: string | null | undefined, next: string | null | undefined): next is string {
  return next !== undefined && next !== null && next !== previous
}

/**
 * Selects current, authorized recipients without deciding anything about the
 * database. There is deliberately no actor/self exclusion: self-notifications
 * are valid for the event types that use this helper.
 */
export function selectEligibleNotificationRecipients(input: NotificationRecipientSelection): string[] {
  const profiles = new Map(input.profiles.map(profile => [profile.id, profile]))
  const members = new Set(input.memberIds)
  const explicitIds = [...new Set(input.requestedIds ?? [])]
  const candidateIds = explicitIds.length > 0
    ? explicitIds
    : input.fallbackToProjectMembers
      ? [...new Set(input.memberIds)]
      : []
  const selected = new Set<string>()

  for (const id of candidateIds) {
    const profile = profiles.get(id)
    if (!profile || profile.is_active === false) continue
    if (profile.role === 'consultant' && members.has(id)) selected.add(id)
    if (profile.role === 'client' && id === input.projectClientId) selected.add(id)
    // Explicit admins remain valid even when implicit admin inclusion is off.
    if (profile.role === 'admin') selected.add(id)
  }

  if (input.includeAdmins !== false) {
    for (const id of [...new Set(input.adminIds ?? [])]) {
      const profile = profiles.get(id)
      if (profile?.role === 'admin' && profile.is_active !== false) selected.add(id)
    }
  }

  return [...selected]
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeNotificationCursor(value: string | null | undefined): NotificationCursor | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<NotificationCursor>
    if (
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      !isUuid(parsed.id)
    ) {
      return null
    }

    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    return null
  }
}
