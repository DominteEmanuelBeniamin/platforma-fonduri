/* eslint-disable @typescript-eslint/no-explicit-any */
import { Resend } from 'resend'
import { resolveReminderDelivery, resendFromAddress, sanitizeHeaderText } from './email'
import { createSupabaseServiceClient } from './supabase'
import { claimReminder, finalizeReminderClaim, releaseReminderClaim } from './reminder-log'
import { isClientVisibleDocument } from '@/lib/client-visibility'
import { renderReminderDigest } from '@/lib/reminder-email'
import {
  getDaysUntilDeadline,
  getManualReminderType,
  REMINDER_TIME_ZONE,
  type ReminderType,
} from '@/lib/document-reminder'

export type SendReminderResult =
  | {
      ok: true
      reminderType: ReminderType
      source: 'manual'
      sentAt: string
      reminderLogId: string
      providerId: string | null
      requestName: string
      projectId: string
      projectTitle: string
      clientEmail: string
      deliveryOverridden: boolean
      journalSaveFailed?: boolean
    }
  | { ok: false; status: number; error: string }

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function appUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? ''
  try {
    const parsed = new URL(configured)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported protocol')
    return configured.replace(/\/+$/, '')
  } catch {
    return null
  }
}

function requestUrl(base: string, projectId: string, requestId: string, activity: any) {
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

export async function sendDocumentReminder(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string,
  options: { triggeredBy: string },
): Promise<SendReminderResult> {
  const { data: req, error: reqError } = await admin
    .from('document_requirements')
    .select(`
      id, project_id, activity_id, name, description, status, visibility, is_outgoing, deadline_at, deleted_at,
      project:project_id(id, title, client:profiles!projects_client_id_fkey(id, full_name, email)),
      activity:activity_id(id, phase_id, visibility, phase:phase_id(id, visibility))
    `)
    .eq('id', requestId)
    .is('deleted_at', null)
    .maybeSingle()

  if (reqError || !req) return { ok: false, status: 404, error: 'Cererea nu a fost găsită' }
  if ((req as any).status !== 'pending' && (req as any).status !== 'rejected') {
    return { ok: false, status: 409, error: 'Reminderul este disponibil pentru cererile în așteptare sau respinse.' }
  }
  if ((req as any).is_outgoing) {
    return { ok: false, status: 409, error: 'Documentele informative nu primesc reminder.' }
  }
  if (!isClientVisibleDocument(req)) {
    return { ok: false, status: 409, error: 'Cererea nu este publicată — public-o înainte să trimiți reminder clientului.' }
  }

  const requestProject = relation((req as any).project)
  const client = relation(requestProject?.client)
  const deadlineAt = (req as any).deadline_at as string | null
  const reminderType = getManualReminderType(deadlineAt)
  if (!deadlineAt || !reminderType) {
    return { ok: false, status: 400, error: 'Cererea nu are termen limită — setează unul înainte să trimiți reminder.' }
  }

  const delivery = resolveReminderDelivery(client?.email)
  if (!delivery.ok) {
    return {
      ok: false,
      status: delivery.error.code === 'configuration' ? 500 : 400,
      error: delivery.error.message,
    }
  }
  if (!client?.id) return { ok: false, status: 400, error: 'Clientul proiectului nu are un profil valid.' }

  const publicAppUrl = appUrl()
  if (!publicAppUrl) return { ok: false, status: 500, error: 'Platforma nu are configurat un URL public valid.' }

  const projectId = (req as any).project_id as string
  const projectTitle = requestProject?.title ?? projectId
  const requestName = (req as any).name || requestId
  const requestDescription = (req as any).description ?? null
  const clientName = client.full_name ?? null
  const actionUrl = requestUrl(publicAppUrl, projectId, requestId, (req as any).activity)
  const days = getDaysUntilDeadline(deadlineAt, new Date(), REMINDER_TIME_ZONE)
  if (days === null) return { ok: false, status: 400, error: 'Termenul cererii nu este valid.' }
  const digest = renderReminderDigest({
    audience: 'client',
    recipientName: clientName,
    dashboardUrl: publicAppUrl,
    items: [{
      entityType: 'request',
      entityId: requestId,
      name: requestName,
      description: requestDescription,
      projectTitle,
      deadlineAt,
      threshold: reminderType,
      days,
      url: actionUrl,
    }],
  })

  const claim = await claimReminder(admin, {
    entityType: 'request',
    entityId: requestId,
    projectId,
    recipientId: client.id,
    recipientEmail: delivery.data.intendedEmail,
    recipientKind: 'client',
    threshold: reminderType,
    deadlineAt,
    source: 'manual',
    triggeredBy: options.triggeredBy,
  })
  if (claim.error || !claim.data) {
    console.error('manual reminder claim error:', { requestId, code: 'claim_failed' })
    return { ok: false, status: 500, error: 'Nu am putut pregăti reminderul. Reîncearcă.' }
  }
  if (!claim.data.claimed || !claim.data.logId || !claim.data.claimToken) {
    return { ok: false, status: 409, error: 'Reminderul este deja în curs de trimitere. Reîncearcă peste câteva secunde.' }
  }

  let providerId: string | null = null
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: resendFromAddress('client'),
      to: delivery.data.deliveryEmail,
      subject: sanitizeHeaderText(digest.subject),
      html: digest.html,
      text: digest.text,
    })
    if (emailError) throw emailError
    providerId = emailData?.id ?? null
  } catch {
    console.error('manual reminder provider failure:', { requestId, code: 'provider_failed' })
    try {
      const release = await releaseReminderClaim(admin, claim.data.logId, claim.data.claimToken)
      if (release.error || release.data !== true) console.error('manual reminder release failure:', { requestId, code: 'release_failed' })
    } catch {
      console.error('manual reminder release failure:', { requestId, code: 'release_failed' })
    }
    return { ok: false, status: 502, error: 'Trimiterea emailului a eșuat. Reîncearcă.' }
  }

  let finalizeResult: Awaited<ReturnType<typeof finalizeReminderClaim>> | null = null
  try {
    finalizeResult = await finalizeReminderClaim(
      admin,
      claim.data.logId,
      claim.data.claimToken,
      providerId,
    )
  } catch {
    console.error('manual reminder finalize failure:', { requestId, code: 'finalize_exception' })
  }
  const sentAt = new Date().toISOString()
  const journalSaveFailed = Boolean(!finalizeResult || finalizeResult.error || !finalizeResult.data?.finalized)
  if (journalSaveFailed) {
    console.error('manual reminder finalize failure:', { requestId, code: 'finalize_failed' })
  }

  return {
    ok: true,
    reminderType,
    source: 'manual',
    sentAt,
    reminderLogId: claim.data.logId,
    providerId,
    requestName,
    projectId,
    projectTitle,
    clientEmail: delivery.data.intendedEmail,
    deliveryOverridden: delivery.data.overridden,
    ...(journalSaveFailed ? { journalSaveFailed: true } : {}),
  }
}
