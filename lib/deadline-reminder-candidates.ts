import { createHash } from 'node:crypto'
import { isClientVisibleDocument } from './client-visibility.js'
import { getDaysUntilDeadline, getReminderType, REMINDER_TIME_ZONE, type ReminderType } from './document-reminder.ts'
import { isValidReminderEmail } from './reminder-email.ts'

export type ReminderProfile = {
  id: string
  full_name: string | null
  email: string | null
}

type Relation<T> = T | T[] | null | undefined

export type ReminderProject = {
  id: string
  title: string
  status: string
  general_consultant_id: string | null
  automatic_reminders_enabled?: boolean
  client: Relation<ReminderProfile>
}

export type ReminderPhase = {
  id: string
  project_id: string
  visibility: 'draft' | 'published'
}

export type ReminderRequest = {
  id: string
  project_id: string
  activity_id: string | null
  name: string
  description: string | null
  deadline_at: string | null
  status: string
  visibility: 'draft' | 'published'
  is_outgoing: boolean
  deleted_at: string | null
  assigned_to: string | null
  activity: Relation<{
    id: string
    phase_id: string
    visibility: 'draft' | 'published'
    assigned_to: string | null
  }>
}

export type ReminderActivity = {
  id: string
  phase_id: string
  name: string
  description: string | null
  deadline_at: string | null
  status: string
  visibility: 'draft' | 'published'
  assigned_to: string | null
}

export type ReminderMember = {
  project_id: string
  consultant_id: string
  profile: Relation<ReminderProfile>
}

export type ReminderCandidate = {
  entityType: 'request' | 'activity'
  entityId: string
  projectId: string
  projectTitle: string
  name: string
  description: string | null
  deadlineAt: string
  threshold: ReminderType
  days: number
  recipientId: string
  recipientEmail: string
  recipientName: string | null
  recipientKind: 'client' | 'consultant'
  url: string
}

export type CandidateFailure = {
  code: 'invalid_email' | 'missing_recipient'
  entityType: 'request' | 'activity'
  entityId: string
  recipientKind: 'client' | 'consultant'
  recipientId: string | null
}

export type CandidateSelectionInput = {
  now: Date
  appUrl: string
  projects: ReminderProject[]
  phases: ReminderPhase[]
  requests: ReminderRequest[]
  activities: ReminderActivity[]
  members: ReminderMember[]
  profiles: Map<string, ReminderProfile>
}

export type CandidateSelection = {
  candidates: ReminderCandidate[]
  failures: CandidateFailure[]
  recipientsConsidered: number
}

export type ReminderNotificationProjectGroup = {
  projectId: string
  items: ReminderCandidate[]
}

const ACTIVE_PROJECT_STATUSES = new Set(['contractare', 'implementare', 'monitorizare'])

type CandidateDraft = Omit<ReminderCandidate, 'recipientEmail' | 'recipientName' | 'recipientId'> & {
  recipientId: string | null
}

function relation<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function requestUrl(base: string, projectId: string, requestId: string, activity: ReminderRequest['activity']) {
  const currentActivity = relation(activity)
  if (currentActivity?.id && currentActivity.phase_id) {
    return base + '/projects/' + projectId + '?' + new URLSearchParams({
      phase: currentActivity.phase_id,
      activity: currentActivity.id,
      document: requestId,
    }).toString() + '#activity-' + currentActivity.id
  }
  return base + '/projects/' + projectId + '?' + new URLSearchParams({
    phase: '__general__',
    document: requestId,
  }).toString() + '#general-requests'
}

function activityUrl(base: string, projectId: string, activityId: string, phaseId: string) {
  return base + '/projects/' + projectId + '?' + new URLSearchParams({
    phase: phaseId,
    activity: activityId,
  }).toString() + '#activity-' + activityId
}

type ReminderNotificationSlot = [
  string,
  ReminderCandidate['entityType'],
  string,
  ReminderCandidate['threshold'],
  string,
]

function notificationSlot(item: ReminderCandidate): ReminderNotificationSlot {
  return [
    item.projectId,
    item.entityType,
    item.entityId,
    item.threshold,
    item.deadlineAt,
  ]
}

type ReminderDigestSlot = [
  ReminderCandidate['recipientKind'],
  string,
  ...ReminderNotificationSlot,
]

function digestSlot(item: ReminderCandidate): ReminderDigestSlot {
  return [item.recipientKind, item.recipientId, ...notificationSlot(item)]
}

function sortedNotificationSlots(items: ReminderCandidate[]) {
  return items
    .map(notificationSlot)
    .sort((left, right) => {
      const a = JSON.stringify(left)
      const b = JSON.stringify(right)
      return a < b ? -1 : a > b ? 1 : 0
    })
}

export function groupReminderCandidatesByProject(items: ReminderCandidate[]): ReminderNotificationProjectGroup[] {
  const groups = new Map<string, ReminderCandidate[]>()
  for (const item of items) {
    const group = groups.get(item.projectId) ?? []
    group.push(item)
    groups.set(item.projectId, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([projectId, projectItems]) => ({ projectId, items: projectItems }))
}

export function buildReminderNotificationEventKey(items: ReminderCandidate[]): string {
  const slots = JSON.stringify(sortedNotificationSlots(items))
  return `deadline-notification-v1-${createHash('sha256').update(slots).digest('hex')}`
}

/**
 * Cheia notificării de admin nu depinde de grupul de destinatari care a produs-o.
 * Doi destinatari care împart același termen convergeau altfel pe chei diferite,
 * iar adminul primea câte un rând de la fiecare.
 */
export function buildReminderAdminNotificationEventKey(item: ReminderCandidate): string {
  const slot = JSON.stringify(notificationSlot(item))
  return `deadline-admin-v1-${createHash('sha256').update(slot).digest('hex')}`
}
export function buildReminderDigestIdempotencyKey(items: ReminderCandidate[]): string {
  const slots = JSON.stringify(items.map(digestSlot).sort((left, right) => {
    const a = JSON.stringify(left)
    const b = JSON.stringify(right)
    return a < b ? -1 : a > b ? 1 : 0
  }))
  return `deadline-digest-v1-${createHash('sha256').update(slots).digest('hex')}`
}

export function hasReminderRecipient(recipientIds: string[], recipientId: string): boolean {
  return recipientIds.includes(recipientId)
}

export function buildReminderNotificationTitle(items: ReminderCandidate[]): string {
  const overdue = items.some(item => item.threshold === 'overdue')
  if (overdue) return items.length === 1 ? 'Termen depășit' : 'Termene depășite'
  return items.length === 1 ? 'Termen apropiat' : 'Termene apropiate'
}

export function reminderNotificationSeverity(items: ReminderCandidate[]): 'danger' | 'warning' {
  return items.some(item => item.threshold === 'overdue') ? 'danger' : 'warning'
}

export function reminderNotificationEntityType(item: ReminderCandidate): 'document_request' | 'activity' {
  return item.entityType === 'request' ? 'document_request' : 'activity'
}
export function selectDeadlineReminderCandidates(input: CandidateSelectionInput): CandidateSelection {
  const projects = new Map(input.projects.map(project => [project.id, project]))
  const phases = new Map(input.phases.map(phase => [phase.id, phase]))
  const membersByProject = new Map<string, (ReminderProfile | null)[]>()
  const recipientKeys = new Set<string>()
  const candidates: ReminderCandidate[] = []
  const failures: CandidateFailure[] = []

  for (const member of input.members) {
    const profile = relation(member.profile) ?? input.profiles.get(member.consultant_id)
    const list = membersByProject.get(member.project_id) ?? []
    if (!profile) list.push(null)
    else if (!list.some(item => item?.id === profile.id)) list.push(profile)
    membersByProject.set(member.project_id, list)
  }

  const fail = (
    entityType: CandidateFailure['entityType'],
    entityId: string,
    recipientKind: CandidateFailure['recipientKind'],
    recipientId: string | null,
    code: CandidateFailure['code'],
  ) => {
    failures.push({ code, entityType, entityId, recipientKind, recipientId })
    recipientKeys.add(`${recipientKind}:${recipientId ?? `${entityType}:${entityId}`}`)
  }

  const add = (
    candidate: CandidateDraft,
    profile: ReminderProfile | null,
  ) => {
    const recipientKind = candidate.recipientKind
    if (!profile?.id) {
      fail(candidate.entityType, candidate.entityId, recipientKind, candidate.recipientId, 'missing_recipient')
      return
    }
    if (!isValidReminderEmail(profile.email)) {
      fail(candidate.entityType, candidate.entityId, recipientKind, profile.id, 'invalid_email')
      return
    }
    recipientKeys.add(`${recipientKind}:${profile.id}`)
    candidates.push({
      ...candidate,
      recipientId: profile.id,
      recipientEmail: profile.email.trim(),
      recipientName: profile.full_name ?? null,
    })
  }

  for (const row of input.requests) {
    const project = projects.get(row.project_id)
    const activity = relation(row.activity)
    if (!project || !ACTIVE_PROJECT_STATUSES.has(project.status)) continue
    if (project.automatic_reminders_enabled === false) continue
    if (row.status !== 'pending' && row.status !== 'rejected') continue
    if (row.is_outgoing || row.deleted_at || !row.deadline_at || !isClientVisibleDocument(row)) continue

    const threshold = getReminderType(row.deadline_at, input.now, REMINDER_TIME_ZONE)
    const days = getDaysUntilDeadline(row.deadline_at, input.now, REMINDER_TIME_ZONE)
    const client = relation(project.client)
    if (!threshold || days === null) continue

    add({
      entityType: 'request',
      entityId: row.id,
      projectId: row.project_id,
      projectTitle: project.title,
      name: row.name,
      description: row.description ?? null,
      deadlineAt: row.deadline_at,
      threshold,
      days,
      recipientId: client?.id ?? null,
      recipientKind: 'client',
      url: requestUrl(input.appUrl, row.project_id, row.id, row.activity),
    }, client)

    if (threshold === 'overdue') {
      const responsibleId = row.assigned_to || activity?.assigned_to || project.general_consultant_id
      add({
        entityType: 'request',
        entityId: row.id,
        projectId: row.project_id,
        projectTitle: project.title,
        name: row.name,
        description: row.description ?? null,
        deadlineAt: row.deadline_at,
        threshold,
        days,
        recipientId: responsibleId ?? null,
        recipientKind: 'consultant',
        url: requestUrl(input.appUrl, row.project_id, row.id, row.activity),
      }, responsibleId ? input.profiles.get(responsibleId) ?? null : null)
    }
  }

  for (const row of input.activities) {
    const phase = phases.get(row.phase_id)
    const project = phase ? projects.get(phase.project_id) : null
    if (!phase || !project || !ACTIVE_PROJECT_STATUSES.has(project.status)) continue
    if (project.automatic_reminders_enabled === false) continue
    if (row.status !== 'pending' && row.status !== 'in_progress') continue
    if (phase.visibility !== 'published' || row.visibility !== 'published' || !row.deadline_at) continue

    const threshold = getReminderType(row.deadline_at, input.now, REMINDER_TIME_ZONE)
    const days = getDaysUntilDeadline(row.deadline_at, input.now, REMINDER_TIME_ZONE)
    if (!threshold || days === null) continue

    const recipients = row.assigned_to
      ? [input.profiles.get(row.assigned_to) ?? null]
      : membersByProject.get(project.id) ?? []
    if (recipients.length === 0) {
      fail('activity', row.id, 'consultant', row.assigned_to, 'missing_recipient')
      continue
    }

    for (const recipient of recipients) {
      add({
        entityType: 'activity',
        entityId: row.id,
        projectId: project.id,
        projectTitle: project.title,
        name: row.name,
        description: row.description ?? null,
        deadlineAt: row.deadline_at,
        threshold,
        days,
        recipientId: recipient?.id ?? row.assigned_to,
        recipientKind: 'consultant',
        url: activityUrl(input.appUrl, project.id, row.id, phase.id),
      }, recipient)
    }
  }

  return { candidates, failures, recipientsConsidered: recipientKeys.size }
}
