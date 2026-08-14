/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { guardToResponse, requireProfile } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import {
  getDaysUntilDeadline,
  getReminderType,
  REMINDER_TIME_ZONE,
  REMINDER_TYPES,
  sameReminderDeadline,
  type ReminderType,
} from '@/lib/document-reminder'
import type {
  ReminderEntityState,
  ReminderRecipientSummary,
  ReminderThresholdState,
} from '@/lib/reminder-state'
import { isClientVisibleDocument } from '@/lib/client-visibility'

type LogRow = {
  id: string
  entity_id: string
  recipient_id: string | null
  recipient_kind: 'client' | 'consultant'
  threshold: ReminderType
  status: 'claimed' | 'sent' | 'skipped'
  source: 'cron' | 'manual' | 'legacy'
  deadline_at: string
  sent_at: string | null
  created_at: string
  claim_expires_at: string | null
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function allowedProjectIds(role: string, profileId: string, rows: any[]) {
  if (role === 'admin') return new Set(rows.map(row => row.project_id).filter(Boolean))
  if (role === 'client') {
    return new Set(rows.filter(row => relation(row.project)?.client_id === profileId).map(row => row.project_id))
  }
  return null
}

function thresholdState(log: LogRow): ReminderThresholdState {
  return {
    threshold: log.threshold,
    status: log.status,
    source: log.source,
    sent_at: log.sent_at,
    created_at: log.created_at,
    reminder_log_id: log.id,
  }
}

function activeLog(log: LogRow, now: Date) {
  return log.status !== 'claimed' || !log.claim_expires_at || new Date(log.claim_expires_at) > now
}

function recipientSummary(logs: LogRow[], baselineRecipientIds: string[] = []): ReminderRecipientSummary {
  const recipientIds = new Set(baselineRecipientIds.filter(Boolean))
  const statusesByRecipient = new Map<string, Set<LogRow['status']>>()
  for (const log of logs) {
    if (!log.recipient_id) continue
    recipientIds.add(log.recipient_id)
    const statuses = statusesByRecipient.get(log.recipient_id) ?? new Set<LogRow['status']>()
    statuses.add(log.status)
    statusesByRecipient.set(log.recipient_id, statuses)
  }
  const summary: ReminderRecipientSummary = { sent: 0, total: recipientIds.size, claimed: 0, skipped: 0 }
  for (const statuses of statusesByRecipient.values()) {
    if (statuses.has('claimed')) summary.claimed++
    else if (statuses.has('sent')) summary.sent++
    else if (statuses.has('skipped')) summary.skipped++
  }
  return summary
}

export async function GET(request: Request) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return guardToResponse(ctx)

  const url = new URL(request.url)
  const entityType = url.searchParams.get('entity_type')
  if (entityType !== 'request' && entityType !== 'activity') {
    return NextResponse.json({ error: 'entity_type must be request or activity' }, { status: 400 })
  }
  if (entityType === 'activity' && ctx.profile.role === 'client') {
    return NextResponse.json({ error: 'Clienții nu pot accesa starea internă a activităților.' }, { status: 403 })
  }

  const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').map(id => id.trim()).filter(Boolean))]
  if (ids.length > 100) return NextResponse.json({ error: 'Maximum 100 ids' }, { status: 400 })
  if (ids.length === 0) return NextResponse.json({ states: {} })

  const admin = createSupabaseServiceClient()
  let rows: any[] = []
  if (entityType === 'request') {
    const result = await admin
      .from('document_requirements')
      .select('id,project_id,deadline_at,visibility,is_outgoing,deleted_at,project:project_id(client_id),activity:activity_id(id,visibility,phase:phase_id(id,visibility))')
      .in('id', ids)
      .is('deleted_at', null)
    if (result.error) return NextResponse.json({ error: 'Failed to load reminder state' }, { status: 500 })
    rows = (result.data ?? []).filter(row => !row.is_outgoing && (ctx.profile.role !== 'client' || isClientVisibleDocument(row)))
  } else {
    const result = await admin
      .from('project_activities')
      .select('id,deadline_at,visibility,assigned_to,phase:phase_id(id,project_id,visibility,project:project_id(client_id))')
      .in('id', ids)
    if (result.error) return NextResponse.json({ error: 'Failed to load reminder state' }, { status: 500 })
    rows = (result.data ?? []).filter(row => {
      const phase = relation(row.phase)
      return phase?.visibility === 'published' && row.visibility === 'published'
    })
  }

  rows = rows.map(row => {
    if (entityType === 'activity') {
      const phase = relation(row.phase)
      return { ...row, project_id: phase?.project_id, project: phase?.project }
    }
    return row
  })

  let allowed = allowedProjectIds(ctx.profile.role, ctx.profile.id, rows)
  if (ctx.profile.role === 'consultant') {
    const projectIds = [...new Set(rows.map(row => row.project_id).filter(Boolean))]
    const memberships = projectIds.length
      ? await admin.from('project_members').select('project_id').eq('consultant_id', ctx.profile.id).in('project_id', projectIds)
      : { data: [] }
    allowed = new Set((memberships.data ?? []).map(row => row.project_id))
  }
  const authorizedRows = rows.filter(row => allowed?.has(row.project_id))
  const authorizedIds = authorizedRows.map(row => row.id)
  if (authorizedIds.length === 0) return NextResponse.json({ states: {} })

  const baselineRecipients = new Map<string, string[]>()
  if (entityType === 'activity' && ctx.profile.role === 'admin') {
    const projectIds = [...new Set(authorizedRows.map(row => row.project_id).filter(Boolean))]
    const members = projectIds.length
      ? await admin.from('project_members').select('project_id,consultant_id').in('project_id', projectIds)
      : { data: [], error: null }
    if (members.error) return NextResponse.json({ error: 'Failed to load reminder recipients' }, { status: 500 })
    const membersByProject = new Map<string, string[]>()
    for (const member of members.data ?? []) {
      const list = membersByProject.get(member.project_id) ?? []
      if (!list.includes(member.consultant_id)) list.push(member.consultant_id)
      membersByProject.set(member.project_id, list)
    }
    for (const row of authorizedRows) {
      baselineRecipients.set(row.id, row.assigned_to
        ? [row.assigned_to]
        : membersByProject.get(row.project_id) ?? [])
    }
  }

  let logQuery = admin
    .from('reminder_log')
    .select('id,entity_id,recipient_id,recipient_kind,threshold,status,source,deadline_at,sent_at,created_at,claim_expires_at')
    .eq('entity_type', entityType)
    .in('entity_id', authorizedIds)
  if (entityType === 'request') {
    logQuery = logQuery.eq('recipient_kind', 'client')
  } else if (ctx.profile.role === 'consultant') {
    logQuery = logQuery.eq('recipient_kind', 'consultant').eq('recipient_id', ctx.profile.id)
  } else {
    logQuery = logQuery.eq('recipient_kind', 'consultant')
  }
  const { data: logs, error: logError } = await logQuery.order('created_at', { ascending: true })
  if (logError) return NextResponse.json({ error: 'Failed to load reminder state' }, { status: 500 })

  const now = new Date()
  const currentRows = new Map(authorizedRows.map(row => [row.id, row]))
  const currentLogs = ((logs ?? []) as LogRow[]).filter(log => {
    const row = currentRows.get(log.entity_id)
    if (!row || !sameReminderDeadline(row.deadline_at, log.deadline_at) || !activeLog(log, now)) return false
    if (entityType !== 'request') return true
    const clientId = relation(row.project)?.client_id
    return log.recipient_kind === 'client' && log.recipient_id === clientId
  })

  const states: Record<string, ReminderEntityState> = {}
  for (const row of authorizedRows) {
    const deadlineAt = row.deadline_at ?? null
    states[row.id] = {
      entity_type: entityType,
      entity_id: row.id,
      deadline_at: deadlineAt,
      days_remaining: getDaysUntilDeadline(deadlineAt, now, REMINDER_TIME_ZONE),
      current_threshold: getReminderType(deadlineAt, now, REMINDER_TIME_ZONE),
      consumed_thresholds: [],
      thresholds: {},
      last_sent: null,
      ...(entityType === 'activity' && ctx.profile.role === 'admin'
        ? { recipient_summary: recipientSummary(currentLogs.filter(log => log.entity_id === row.id), baselineRecipients.get(row.id)) }
        : {}),
    }
  }

  for (const log of currentLogs) {
    const state = states[log.entity_id]
    if (!state) continue
    state.thresholds[log.threshold] = thresholdState(log)
    if (log.status === 'sent' || log.status === 'skipped') {
      if (!state.consumed_thresholds.includes(log.threshold)) state.consumed_thresholds.push(log.threshold)
    }
    if (log.status === 'sent' && (!state.last_sent || (state.last_sent.sent_at ?? '') < (log.sent_at ?? ''))) {
      state.last_sent = thresholdState(log)
    }
  }

  for (const state of Object.values(states)) {
    state.consumed_thresholds = REMINDER_TYPES.filter(type => state.consumed_thresholds.includes(type))
  }
  return NextResponse.json({ states })
}
