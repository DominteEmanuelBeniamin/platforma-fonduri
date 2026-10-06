import { createHash } from 'node:crypto'
import { Resend } from 'resend'
import { createSupabaseServiceClient } from './supabase'
import { escapeHtml, resendFromAddress, sanitizeHeaderText } from './email'

export type ActivityAssignedEmail = {
  consultantId: string
  activityName: string
  phaseName: string
  projectId: string
  projectTitle: string
  deadlineAt: string | null
  idempotencyKey: string
}

type Recipient = { full_name: string | null; email: string }

/** Emailul „Activitate nouă atribuită”, același pentru o atribuire sau pentru un lot. */
function activityAssignedMessage(consultant: Recipient, params: ActivityAssignedEmail) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const projectUrl = `${appUrl}/projects/${params.projectId}`
  const safeProjectTitle = escapeHtml(params.projectTitle)
  const safeActivityName = escapeHtml(params.activityName)
  const safePhaseName = escapeHtml(params.phaseName)
  const salut = consultant.full_name ? `Salut, ${escapeHtml(consultant.full_name)}!` : 'Salut!'
  const deadline = params.deadlineAt
    ? new Date(params.deadlineAt).toLocaleDateString('ro-RO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

    <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:32px 40px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Activitate nouă atribuită</h1>
      <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">${safeProjectTitle}</p>
    </div>

    <div style="padding:32px 40px;">
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">${salut}</p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;">
        Ți-a fost atribuită o nouă activitate în proiectul <strong>${safeProjectTitle}</strong>.
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 28px;">
        <p style="margin:0 0 12px;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Detalii activitate</p>
        <p style="margin:0 0 8px;color:#111827;font-size:16px;font-weight:600;">${safeActivityName}</p>
        <p style="margin:0 0 10px;color:#4b5563;font-size:14px;line-height:1.6;">Fază: ${safePhaseName}</p>
        ${deadline ? `<p style="margin:0;color:#d97706;font-size:13px;font-weight:500;">⏱ Termen limită: ${deadline}</p>` : ''}
      </div>

      <a href="${projectUrl}"
         style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.01em;">
        Mergi la proiect →
      </a>
    </div>

    <div style="padding:20px 40px;border-top:1px solid #f1f5f9;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Acest email a fost generat automat de Platforma Fonduri EU. Nu răspunde la acest mesaj.
      </p>
    </div>
  </div>
</body>
</html>`

  return {
    to: consultant.email,
    subject: sanitizeHeaderText(`Ți-a fost atribuită o activitate nouă — ${params.projectTitle}`),
    html,
  }
}

// Trimite email consultantului nou atribuit (erorile nu blochează salvarea)
export async function sendActivityAssignedEmail(params: ActivityAssignedEmail) {
  try {
    const { data: consultant, error: consultantError } = await createSupabaseServiceClient()
      .from('profiles')
      .select('full_name, email, is_active')
      .eq('id', params.consultantId)
      .maybeSingle()

    if (consultantError) throw consultantError
    if (!consultant?.email || consultant.is_active === false) return

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error: emailError } = await resend.emails.send({
      from: resendFromAddress(),
      ...activityAssignedMessage({ full_name: consultant.full_name, email: consultant.email }, params),
    }, { idempotencyKey: params.idempotencyKey })
    if (emailError) {
      console.error('Resend error:', emailError)
    }
  } catch (emailError) {
    console.error('Activity assigned email send error (non-blocking):', emailError)
  }
}

/**
 * Mai multe atribuiri deodată, la importul unui șablon într-un dosar nou:
 * profilurile se citesc într-o cerere și emailurile pleacă într-un singur lot
 * Resend (cel mult 100 pe lot), nu câte o cerere per activitate, care ar fi
 * atins și limita de rată a Resend. Conținutul e același ca la o atribuire
 * individuală. Erorile nu blochează importul.
 */
export async function sendActivityAssignedEmails(items: ActivityAssignedEmail[]) {
  if (items.length === 0) return
  try {
    const consultantIds = [...new Set(items.map(item => item.consultantId))]
    const { data: consultants, error: consultantsError } = await createSupabaseServiceClient()
      .from('profiles')
      .select('id, full_name, email, is_active')
      .in('id', consultantIds)

    if (consultantsError) throw consultantsError
    const byId = new Map((consultants ?? []).map(consultant => [consultant.id as string, consultant]))
    const messages = items.flatMap(item => {
      const consultant = byId.get(item.consultantId)
      if (!consultant?.email || consultant.is_active === false) return []
      return [{
        recipientId: item.consultantId,
        key: item.idempotencyKey,
        email: {
          from: resendFromAddress(),
          ...activityAssignedMessage({ full_name: consultant.full_name, email: consultant.email }, item),
        },
      }]
    })
    if (messages.length === 0) return

    const resend = new Resend(process.env.RESEND_API_KEY)
    for (let index = 0; index < messages.length; index += 100) {
      const chunk = messages.slice(index, index + 100)
      const { data: currentProfiles, error: currentProfilesError } = await createSupabaseServiceClient()
        .from('profiles')
        .select('id, is_active')
        .in('id', [...new Set(chunk.map(message => message.recipientId))])
      if (currentProfilesError) throw currentProfilesError
      const activeRecipientIds = new Set((currentProfiles ?? [])
        .filter(profile => profile.is_active !== false)
        .map(profile => profile.id))
      const sendable = chunk.filter(message => activeRecipientIds.has(message.recipientId))
      if (sendable.length === 0) continue

      const idempotencyKey = `assignment-email-batch-v1-${createHash('sha256').update(sendable.map(message => message.key).join('|')).digest('hex')}`
      const { error: emailError } = await resend.batch.send(sendable.map(message => message.email), { idempotencyKey })
      if (emailError) {
        console.error('Resend batch error:', emailError)
      }
    }
  } catch (emailError) {
    console.error('Activity assigned batch email error (non-blocking):', emailError)
  }
}
