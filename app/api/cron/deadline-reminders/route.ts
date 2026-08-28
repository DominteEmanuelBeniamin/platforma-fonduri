/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { resolveReminderDelivery, resendFromAddress, sanitizeHeaderText } from '@/app/api/_utils/email'
import { claimReminder, finalizeReminderClaim, releaseReminderClaim } from '@/app/api/_utils/reminder-log'
import { logReminderDigestAudit } from '@/app/api/_utils/reminder-audit'
import { acquireReminderRunLease, releaseReminderRunLease } from '@/app/api/_utils/reminder-run'
import { deleteNotificationsByIds, recordNotification } from '@/app/api/_utils/notifications'
import {
  buildReminderDigestIdempotencyKey,
  buildReminderNotificationEventKey,
  buildReminderNotificationTitle,
  groupReminderCandidatesByProject,
  hasReminderRecipient,
  selectDeadlineReminderCandidates,
  type ReminderCandidate,
  type ReminderProfile,
} from '@/lib/deadline-reminder-candidates'
import { shouldReleaseClaimsAfterNotificationCleanup } from '@/lib/notification-utils'
import { renderReminderDigest } from '@/lib/reminder-email'

type RecipientGroup = {
  recipientId: string
  recipientEmail: string
  recipientName: string | null
  recipientKind: 'client' | 'consultant'
  items: ReminderCandidate[]
}

type ClaimedReminder = {
  item: ReminderCandidate
  logId: string
  claimToken: string
}

type FailureCounts = {
  invalid_email: number
  missing_recipient: number
  claim: number
  provider: number
  notification: number
  finalize: number
  release: number
  audit: number
}

type CronReport = {
  ok: boolean
  run_id: string
  skipped_run: boolean
  recipients_considered: number
  emails_attempted: number
  emails_accepted: number
  thresholds_sent: number
  thresholds_skipped: number
  failures: FailureCounts
  error?: string
}

const EMPTY_FAILURES = (): FailureCounts => ({
  invalid_email: 0,
  missing_recipient: 0,
  claim: 0,
  provider: 0,
  notification: 0,
  finalize: 0,
  release: 0,
  audit: 0,
})

function emptyReport(runId: string, skippedRun = false): CronReport {
  return {
    ok: true,
    run_id: runId,
    skipped_run: skippedRun,
    recipients_considered: 0,
    emails_attempted: 0,
    emails_accepted: 0,
    thresholds_sent: 0,
    thresholds_skipped: 0,
    failures: EMPTY_FAILURES(),
  }
}

function logFailure(runId: string, code: string, entityType?: string, entityId?: string) {
  console.error('deadline reminder failure', {
    run_id: runId,
    code,
    ...(entityType ? { entity_type: entityType } : {}),
    ...(entityId ? { entity_id: entityId } : {}),
  })
}

function addCandidate(groups: Map<string, RecipientGroup>, candidate: ReminderCandidate) {
  const key = `${candidate.recipientKind}:${candidate.recipientId}`
  let group = groups.get(key)
  if (!group) {
    group = {
      recipientId: candidate.recipientId,
      recipientEmail: candidate.recipientEmail,
      recipientName: candidate.recipientName,
      recipientKind: candidate.recipientKind,
      items: [],
    }
    groups.set(key, group)
  }
  if (!group.items.some(item =>
    item.entityType === candidate.entityType &&
    item.entityId === candidate.entityId &&
    item.threshold === candidate.threshold
  )) group.items.push(candidate)
}

async function releaseClaims(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  claimed: ClaimedReminder[],
  runId: string,
  report: CronReport,
) {
  for (const entry of claimed) {
    try {
      const release = await releaseReminderClaim(admin, entry.logId, entry.claimToken)
      if (release.error || release.data !== true) throw release.error ?? new Error('release returned false')
    } catch {
      report.failures.release++
      logFailure(runId, 'release_failed', entry.item.entityType, entry.item.entityId)
    }
  }
}

async function compensateNotificationsAndReleaseClaims(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  claimed: ClaimedReminder[],
  notificationIds: readonly string[],
  runId: string,
  report: CronReport,
  failureCode: string,
) {
  let cleanupSucceeded = true
  try {
    await deleteNotificationsByIds(admin, notificationIds)
  } catch (error) {
    cleanupSucceeded = false
    report.ok = false
    report.error ??= 'Unele claims nu au putut fi eliberate după eșecul notificării.'
    report.failures.notification++
    console.error('deadline reminder notification compensation failed — claims kept for repair:', {
      run_id: runId,
      notification_ids: notificationIds,
      claim_ids: claimed.map(entry => entry.logId),
      error,
    })
    logFailure(runId, 'notification_compensation_failed', claimed[0]?.item.entityType, claimed[0]?.item.entityId)
  }

  if (shouldReleaseClaimsAfterNotificationCleanup(notificationIds, cleanupSucceeded)) {
    await releaseClaims(admin, claimed, runId, report)
  } else {
    logFailure(runId, failureCode, claimed[0]?.item.entityType, claimed[0]?.item.entityId)
  }
}

async function recordDeadlineNotifications(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  claimed: ClaimedReminder[],
  group: RecipientGroup,
  runId: string,
  report: CronReport,
) {
  const projectGroups = groupReminderCandidatesByProject(claimed.map(entry => entry.item))
  const insertedNotificationIds: string[] = []
  for (const projectGroup of projectGroups) {
    const items = projectGroup.items
    const onlyItem = items.length === 1 ? items[0] : null
    try {
      const result = await recordNotification(admin, {
        projectId: projectGroup.projectId,
        type: 'deadline',
        entityType: onlyItem ? onlyItem.entityType === 'request' ? 'document_request' : 'activity' : 'project',
        entityId: onlyItem?.entityId ?? projectGroup.projectId,
        title: buildReminderNotificationTitle(items),
        itemCount: items.length,
        eventKey: buildReminderNotificationEventKey(items),
        recipientIds: [group.recipientId],
        includeAdmins: true,
      })
      insertedNotificationIds.push(...result.insertedIds)
      if (!hasReminderRecipient(result.recipientIds, group.recipientId)) {
        throw new Error('logical reminder recipient is no longer eligible')
      }
    } catch {
      report.failures.notification++
      logFailure(runId, 'notification_failed', items[0]?.entityType, items[0]?.entityId)
      return { ok: false, insertedNotificationIds }
    }
  }
  return { ok: true, insertedNotificationIds }
}

async function processRecipient(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  group: RecipientGroup,
  runId: string,
  appUrl: string,
  report: CronReport,
) {
  const delivery = resolveReminderDelivery(group.recipientEmail)
  if (!delivery.ok) {
    report.failures[delivery.error.code === 'invalid_email' ? 'invalid_email' : 'provider']++
    logFailure(runId, delivery.error.code, group.items[0]?.entityType, group.items[0]?.entityId)
    return
  }

  const claimed: ClaimedReminder[] = []
  for (const item of group.items) {
    let result: Awaited<ReturnType<typeof claimReminder>>
    try {
      result = await claimReminder(admin, {
        entityType: item.entityType,
        entityId: item.entityId,
        projectId: item.projectId,
        recipientId: group.recipientId,
        recipientEmail: group.recipientEmail,
        recipientKind: group.recipientKind,
        threshold: item.threshold,
        deadlineAt: item.deadlineAt,
        source: 'cron',
        runId,
      })
    } catch {
      report.failures.claim++
      logFailure(runId, 'claim_exception', item.entityType, item.entityId)
      continue
    }
    if (result.error) {
      report.failures.claim++
      logFailure(runId, 'claim_failed', item.entityType, item.entityId)
      continue
    }
    if (result.data?.claimed && result.data.logId && result.data.claimToken) {
      claimed.push({ item, logId: result.data.logId, claimToken: result.data.claimToken })
    }
  }

  if (claimed.length === 0) return

  const notificationResult = await recordDeadlineNotifications(admin, claimed, group, runId, report)
  if (!notificationResult.ok) {
    await compensateNotificationsAndReleaseClaims(
      admin,
      claimed,
      notificationResult.insertedNotificationIds,
      runId,
      report,
      'notification_failure_claims_kept',
    )
    return
  }

  let digest: ReturnType<typeof renderReminderDigest>
  try {
    digest = renderReminderDigest({
      audience: group.recipientKind,
      recipientName: group.recipientName,
      dashboardUrl: appUrl,
      items: claimed.map(entry => entry.item),
    })
  } catch {
    report.failures.provider++
    logFailure(runId, 'renderer_failed', claimed[0].item.entityType, claimed[0].item.entityId)
    await compensateNotificationsAndReleaseClaims(
      admin,
      claimed,
      notificationResult.insertedNotificationIds,
      runId,
      report,
      'renderer_failure_claims_kept',
    )
    return
  }
  report.emails_attempted++
  let providerId: string | null = null
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const result = await resend.emails.send({
      from: resendFromAddress(group.recipientKind === 'client' ? 'client' : 'internal'),
      to: delivery.data.deliveryEmail,
      subject: sanitizeHeaderText(digest.subject),
      html: digest.html,
      text: digest.text,
    }, { idempotencyKey: buildReminderDigestIdempotencyKey(claimed.map(entry => entry.item)) })
    if (result.error) throw result.error
    providerId = result.data?.id ?? null
    report.emails_accepted++
  } catch {
    report.failures.provider++
    logFailure(runId, 'provider_failed', claimed[0].item.entityType, claimed[0].item.entityId)
    await compensateNotificationsAndReleaseClaims(
      admin,
      claimed,
      notificationResult.insertedNotificationIds,
      runId,
      report,
      'provider_failure_claims_kept',
    )
    return
  }

  const auditError = await logReminderDigestAudit(admin, {
    runId,
    providerId,
    recipientId: group.recipientId,
    recipientEmail: delivery.data.intendedEmail,
    recipientKind: group.recipientKind,
    deliveryOverridden: delivery.data.overridden,
    items: claimed.map(entry => entry.item),
  })
  if (auditError) {
    report.failures.audit++
    logFailure(runId, 'audit_failed', claimed[0].item.entityType, claimed[0].item.entityId)
  }

  for (const entry of claimed) {
    let finalizeResult: Awaited<ReturnType<typeof finalizeReminderClaim>>
    try {
      finalizeResult = await finalizeReminderClaim(admin, entry.logId, entry.claimToken, providerId)
    } catch {
      report.failures.finalize++
      logFailure(runId, 'finalize_exception', entry.item.entityType, entry.item.entityId)
      continue
    }
    if (finalizeResult.error || !finalizeResult.data?.finalized) {
      report.failures.finalize++
      logFailure(runId, 'finalize_failed', entry.item.entityType, entry.item.entityId)
      continue
    }
    report.thresholds_sent++
    report.thresholds_skipped += finalizeResult.data.skippedCount
  }
}

async function runCron(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  runId: string,
  appUrl: string,
): Promise<CronReport> {
  const report = emptyReport(runId)
  const configuration = resolveReminderDelivery('probe@example.com')
  if (!configuration.ok) {
    report.ok = false
    report.error = configuration.error.message
    return report
  }

  const now = new Date()
  const { data: projectRows, error: projectError } = await admin
    .from('projects')
    .select('id,title,status,client_id,general_consultant_id,automatic_reminders_enabled,client:profiles!projects_client_id_fkey(id,full_name,email)')
    .in('status', ['contractare', 'implementare', 'monitorizare'])
  if (projectError) {
    logFailure(runId, 'project_query_failed')
    report.ok = false
    report.error = 'Nu am putut încărca proiectele pentru reminder.'
    return report
  }

  const projects = (projectRows ?? []) as any[]
  const projectIds = projects.map(project => project.id as string)
  if (projectIds.length === 0) return report

  const [{ data: phaseRows, error: phaseError }, { data: requestRows, error: requestError }] = await Promise.all([
    admin.from('project_phases').select('id,project_id,name,visibility').in('project_id', projectIds),
    admin.from('document_requirements')
      .select('id,project_id,activity_id,name,description,deadline_at,status,visibility,is_outgoing,deleted_at,assigned_to,activity:activity_id(id,name,phase_id,visibility,assigned_to,phase:phase_id(id,name,visibility))')
      .in('project_id', projectIds)
      .in('status', ['pending', 'rejected'])
      .eq('is_outgoing', false)
      .is('deleted_at', null)
      .not('deadline_at', 'is', null),
  ])
  if (phaseError || requestError) {
    logFailure(runId, 'entity_query_failed')
    report.ok = false
    report.error = 'Nu am putut încărca cererile pentru reminder.'
    return report
  }

  const phases = (phaseRows ?? []) as any[]
  const phaseIds = phases.map(phase => phase.id as string)
  const { data: activityRows, error: activityError } = phaseIds.length
    ? await admin.from('project_activities')
      .select('id,name,description,deadline_at,status,visibility,assigned_to,phase_id')
      .in('phase_id', phaseIds)
      .in('status', ['pending', 'in_progress'])
      .not('deadline_at', 'is', null)
    : { data: [], error: null }
  if (activityError) {
    logFailure(runId, 'activity_query_failed')
    report.ok = false
    report.error = 'Nu am putut încărca activitățile pentru reminder.'
    return report
  }

  const { data: memberRows, error: memberError } = await admin
    .from('project_members')
    .select('project_id,consultant_id,profile:consultant_id(id,full_name,email)')
    .in('project_id', projectIds)
  if (memberError) {
    logFailure(runId, 'member_query_failed')
    report.ok = false
    report.error = 'Nu am putut încărca membrii proiectelor pentru reminder.'
    return report
  }

  const consultantIds = new Set<string>()
  for (const project of projects) if (project.general_consultant_id) consultantIds.add(project.general_consultant_id)
  for (const row of requestRows ?? []) {
    const activity = Array.isArray(row.activity) ? row.activity[0] : row.activity
    if (row.assigned_to) consultantIds.add(row.assigned_to)
    if (activity?.assigned_to) consultantIds.add(activity.assigned_to)
  }
  for (const row of activityRows ?? []) if (row.assigned_to) consultantIds.add(row.assigned_to)
  for (const row of memberRows ?? []) if (row.consultant_id) consultantIds.add(row.consultant_id)

  let consultantRows: any[] = []
  if (consultantIds.size) {
    const result = await admin.from('profiles').select('id,full_name,email').in('id', [...consultantIds])
    if (result.error) logFailure(runId, 'profile_query_failed')
    consultantRows = (result.data ?? []) as any[]
  }
  const profiles = new Map<string, ReminderProfile>(consultantRows.map(profile => [profile.id, profile]))

  const selected = selectDeadlineReminderCandidates({
    now,
    appUrl,
    projects,
    phases,
    requests: (requestRows ?? []) as any,
    activities: (activityRows ?? []) as any,
    members: (memberRows ?? []) as any,
    profiles,
  })
  report.recipients_considered = selected.recipientsConsidered
  for (const failure of selected.failures) {
    report.failures[failure.code]++
    logFailure(runId, failure.code, failure.entityType, failure.entityId)
  }

  const groups = new Map<string, RecipientGroup>()
  for (const candidate of selected.candidates) addCandidate(groups, candidate)
  for (const group of groups.values()) {
    try {
      await processRecipient(admin, group, runId, appUrl, report)
    } catch {
      report.failures.provider++
      logFailure(runId, 'recipient_processing_failed', group.items[0]?.entityType, group.items[0]?.entityId)
    }
  }
  return report
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl = (() => {
    const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? ''
    try {
      const parsed = new URL(configured)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol')
      return configured.replace(/\/+$/, '')
    } catch {
      return null
    }
  })()
  const runId = crypto.randomUUID()
  if (!appUrl) return NextResponse.json({ ok: false, run_id: runId, error: 'Invalid public app URL' }, { status: 500 })

  const admin = createSupabaseServiceClient()
  const lease = await acquireReminderRunLease(admin, runId)
  if (lease.error) {
    logFailure(runId, 'lease_acquire_failed')
    return NextResponse.json({ ok: false, run_id: runId, error: 'Nu am putut bloca rularea reminderelor.' }, { status: 500 })
  }
  if (!lease.acquired) {
    return NextResponse.json(emptyReport(runId, true), { status: 200 })
  }

  let report = emptyReport(runId)
  try {
    report = await runCron(admin, runId, appUrl)
  } catch {
    report.ok = false
    report.error = 'Rularea reminderelor a eșuat.'
    logFailure(runId, 'run_failed')
  } finally {
    const release = await releaseReminderRunLease(admin, runId)
    if (release.error || !release.released) {
      report.failures.release++
      report.ok = false
      logFailure(runId, 'lease_release_failed')
    }
  }

  return NextResponse.json(report, { status: report.ok ? 200 : 500 })
}
