/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/_utils/document-reminder.ts
import { Resend } from 'resend'
import { escapeHtml, sanitizeHeaderText } from './email'
import { createSupabaseServiceClient } from './supabase'
import {
  formatDeadline,
  generateReminderEmailContent,
  getDaysUntilDeadline,
  getReminderType,
  REMINDER_LABELS,
  type ReminderContext,
  type ReminderType,
} from '@/lib/document-reminder'

export type SendReminderResult =
  | {
      ok: true
      reminderType: ReminderType
      sentAt: string
      requestName: string
      projectId: string
      projectTitle: string
      clientEmail: string
      // Emailul a plecat, dar update-ul reminder_sent_at/reminder_type_sent a eșuat
      // (ex. glitch tranzitoriu de DB). Nu tratăm asta ca eșec total — clientul chiar
      // a primit emailul — ca să nu împingem apelantul spre o retrimitere duplicată.
      stateSaveFailed?: boolean
    }
  | { ok: false; status: number; error: string }

// Accent-uri per urgență — aceleași nuanțe ca REMINDER_BADGE din UI, ca emailul
// să se simtă continuarea aceluiași sistem vizual, nu un template separat.
const REMINDER_EMAIL_ACCENT: Record<ReminderType, { bg: string; text: string }> = {
  '1_week':   { bg: '#eff6ff', text: '#1d4ed8' },
  '3_days':   { bg: '#fffbeb', text: '#b45309' },
  '1_day':    { bg: '#fff7ed', text: '#c2410c' },
  'same_day': { bg: '#fef2f2', text: '#b91c1c' },
  'overdue':  { bg: '#fff1f2', text: '#be123c' },
}

function listHtml(items: string[], ordered: boolean) {
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag} style="margin:0;padding:0 0 0 18px;color:#111827;font-size:14px;line-height:1.7;">${items
    .map(item => `<li>${item}</li>`)
    .join('')}</${tag}>`
}

function buildReminderCopy(safeProjectTitle: string, days: number | null, type: ReminderType) {
  switch (type) {
    case '1_week':
      return {
        headline: 'Document necesar în curând',
        intro: `Vă contactăm pentru a vă aminti că aveți un document necesar în aproximativ o săptămână pentru proiectul <strong>${safeProjectTitle}</strong>. Vă recomandăm să pregătiți documentul din timp pentru a evita întârzierile.`,
        body: listHtml([
          'Pregătiți documentul solicitat (scanare sau export PDF).',
          'Accesați platforma și mergeți la proiectul dumneavoastră.',
          'Încărcați documentul în secțiunea corespunzătoare.',
          'Confirmați că documentul a fost trimis spre revizuire.',
        ], true),
      }
    case '3_days':
      return {
        headline: 'Termen limită apropiat',
        intro: `Vă atragem atenția că termenul limită pentru un document important din proiectul <strong>${safeProjectTitle}</strong> se apropie — mai aveți ${days} ${days === 1 ? 'zi' : 'zile'} la dispoziție. Vă rugăm să acționați cât mai curând.`,
        body: listHtml([
          'Accesați platforma cât mai curând.',
          'Navigați la proiectul dumneavoastră și găsiți cererea de document.',
          'Încărcați documentul necesar.',
        ], true) + '<p style="margin:12px 0 0;color:#4b5563;font-size:14px;">Dacă întâmpinați dificultăți în pregătirea documentului, contactați-ne imediat.</p>',
      }
    case '1_day':
      return {
        headline: 'Termenul expiră mâine',
        intro: `Termenul limită pentru documentul solicitat în cadrul proiectului <strong>${safeProjectTitle}</strong> expiră mâine. Vă rugăm să încărcați documentul astăzi pe platformă.`,
        body: listHtml([
          'Accesați platforma astăzi și încărcați documentul.',
          'Dacă nu puteți livra documentul în timp util, contactați-ne imediat.',
        ], false),
      }
    case 'same_day':
      return {
        headline: 'Termenul expiră ASTĂZI',
        intro: `Termenul limită pentru documentul solicitat în cadrul proiectului <strong>${safeProjectTitle}</strong> expiră <strong>ASTĂZI</strong>. Este necesară acțiunea imediată pentru a nu întârzia procesarea dosarului.`,
        body: listHtml([
          'Accesați platforma și încărcați documentul chiar acum.',
          'Orice întârziere poate afecta procesarea dosarului dumneavoastră.',
          'Pentru asistență urgentă, contactați consultantul atribuit.',
        ], false),
      }
    case 'overdue':
      return {
        headline: 'Termen expirat',
        intro: `Termenul limită pentru documentul solicitat în cadrul proiectului <strong>${safeProjectTitle}</strong> a expirat. Vă rugăm să ne contactați de urgență pentru a discuta despre pașii următori și posibilele consecințe asupra dosarului.`,
        body: `<p style="margin:0 0 10px;color:#374151;font-size:14px;">Este important să ne contactați cât mai rapid pentru a:</p>` + listHtml([
          'Evalua situația și impactul asupra dosarului.',
          'Stabili dacă documentul mai poate fi acceptat.',
          'Identifica soluții alternative, dacă există.',
        ], false),
      }
  }
}

function buildReminderEmailHtml(ctx: ReminderContext, type: ReminderType, projectUrl: string): string {
  const safeProjectTitle = escapeHtml(ctx.projectTitle)
  const safeRequestName = escapeHtml(ctx.requestName)
  const salut = ctx.clientName ? `Bună ziua, ${escapeHtml(ctx.clientName)},` : 'Bună ziua,'
  const days = getDaysUntilDeadline(ctx.deadlineAt)
  const deadline = ctx.deadlineAt ? formatDeadline(ctx.deadlineAt) : null
  const accent = REMINDER_EMAIL_ACCENT[type]
  const { headline, intro, body } = buildReminderCopy(safeProjectTitle, days, type)

  const descriptionHtml = ctx.requestDescription
    ? `<p style="margin:0 0 10px;color:#4b5563;font-size:14px;line-height:1.6;">${escapeHtml(ctx.requestDescription).replace(/\n/g, '<br>')}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

    <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:32px 40px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">${headline}</h1>
      <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">${safeProjectTitle}</p>
    </div>

    <div style="padding:32px 40px;">
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">${salut}</p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">${intro}</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 24px;">
        <span style="display:inline-block;margin:0 0 12px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${accent.bg};color:${accent.text};">${REMINDER_LABELS[type]}</span>
        <p style="margin:0 0 8px;color:#111827;font-size:16px;font-weight:600;">${safeRequestName}</p>
        ${descriptionHtml}
        ${deadline ? `<p style="margin:0;color:${accent.text};font-size:13px;font-weight:600;">⏱ Termen limită: ${deadline}</p>` : ''}
      </div>

      ${body}

      <a href="${projectUrl}"
         style="display:inline-block;margin-top:24px;background:#4f46e5;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.01em;">
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
}

/**
 * Trimite real, prin Resend, emailul de reminder pentru o cerere de document și
 * marchează reminder_sent_at / reminder_type_sent. Extrasă separat de rută ca să
 * poată fi reutilizată și de trimiterea automată programată (#21, cron, Faza 3),
 * fără un apel HTTP intern — doar auth-ul și audit log-ul rămân în responsabilitatea
 * apelantului (diferă între click manual și job automat).
 */
export async function sendDocumentReminder(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  requestId: string
): Promise<SendReminderResult> {
  const { data: req, error: reqError } = await admin
    .from('document_requirements')
    .select(`
      id, project_id, name, description, status, deadline_at, deleted_at,
      project:project_id(id, title, client:profiles!projects_client_id_fkey(full_name, email))
    `)
    .eq('id', requestId)
    .is('deleted_at', null)
    .maybeSingle()

  if (reqError || !req) {
    return { ok: false, status: 404, error: 'Cererea nu a fost găsită' }
  }

  if ((req as any).status !== 'pending') {
    return { ok: false, status: 409, error: 'Cererea are deja un răspuns de verificat.' }
  }

  const project = (req as any).project
  const client = project?.client
  if (!client?.email) {
    return { ok: false, status: 400, error: 'Clientul proiectului nu are un email valid' }
  }

  const projectTitle = project?.title ?? (req as any).project_id
  const requestName = (req as any).name || requestId
  const projectId = (req as any).project_id
  const reminderType = getReminderType((req as any).deadline_at) ?? '1_week'

  const reminderCtx: ReminderContext = {
    requestName,
    requestDescription: (req as any).description,
    deadlineAt: (req as any).deadline_at,
    clientEmail: client.email,
    clientName: client.full_name ?? null,
    projectTitle,
    projectId,
  }

  const { subject, textBody } = generateReminderEmailContent(reminderCtx, reminderType)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const html = buildReminderEmailHtml(reminderCtx, reminderType, `${appUrl}/projects/${projectId}`)

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error: emailError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'notificari@vorbaretul.ro',
      to: client.email,
      subject: sanitizeHeaderText(subject),
      html,
      text: textBody,
    })
    if (emailError) {
      console.error('sendDocumentReminder Resend error:', emailError)
      return { ok: false, status: 502, error: 'Trimiterea emailului a eșuat. Reîncearcă.' }
    }
  } catch (emailException) {
    console.error('sendDocumentReminder Resend exception:', emailException)
    return { ok: false, status: 502, error: 'Trimiterea emailului a eșuat. Reîncearcă.' }
  }

  // Emailul a plecat deja — de aici încolo un eșec e doar de persistare a stării,
  // nu mai poate fi tratat ca eșec total (ar împinge apelantul spre retrimitere
  // duplicată a unui email real către client). Încercăm update-ul de două ori
  // pentru glitch-uri tranzitorii, apoi raportăm succes cu stateSaveFailed.
  const sentAt = new Date().toISOString()
  let stateSaveFailed = false
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error: updateError } = await admin
      .from('document_requirements')
      .update({ reminder_sent_at: sentAt, reminder_type_sent: reminderType })
      .eq('id', requestId)
      .is('deleted_at', null)

    if (!updateError) {
      stateSaveFailed = false
      break
    }
    console.error(`sendDocumentReminder update error (attempt ${attempt}):`, updateError)
    stateSaveFailed = true
  }

  return {
    ok: true,
    reminderType,
    sentAt,
    requestName,
    projectId,
    projectTitle,
    clientEmail: client.email,
    ...(stateSaveFailed ? { stateSaveFailed: true } : {}),
  }
}
