/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { isClientVisibleActivity, isClientVisibleDocument, isClientVisiblePhase } from '@/lib/client-visibility'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function listSection(title: string, items: string[]) {
  if (items.length === 0) return ''
  return `
      <div style="margin:0 0 20px;">
        <p style="margin:0 0 8px;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">${title}</p>
        <ul style="margin:0;padding:0 0 0 18px;color:#111827;font-size:14px;line-height:1.7;">
          ${items.map(item => `<li>${item}</li>`).join('')}
        </ul>
      </div>`
}

// POST /api/projects/[id]/notify-client
// Trimite un singur email digest cu tot ce a fost publicat de la ultima notificare.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)
    if (access.profile.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea' }, { status: 403 })
    }

    const admin = createSupabaseServiceClient()

    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id, title, client:client_id(id, full_name, email)')
      .eq('id', projectId)
      .maybeSingle()

    if (projectError) {
      console.error('notify-client project fetch error:', projectError)
      return NextResponse.json({ error: 'Eroare la încărcarea proiectului' }, { status: 500 })
    }
    if (!project) {
      return NextResponse.json({ error: 'Proiectul nu a fost găsit' }, { status: 404 })
    }
    const client = Array.isArray(project.client) ? project.client[0] : project.client
    if (!client?.email) {
      return NextResponse.json({ error: 'Clientul proiectului nu are un email valid' }, { status: 400 })
    }

    const [{ data: phases, error: phasesError }, { data: documents, error: documentsError }] = await Promise.all([
      admin
        .from('project_phases')
        .select('id, name, visibility, client_notified_at')
        .eq('project_id', projectId),
      admin
        .from('document_requirements')
        .select('id, name, visibility, client_notified_at, activity_id, is_outgoing')
        .eq('project_id', projectId)
        .is('deleted_at', null),
    ])

    if (phasesError || documentsError) {
      console.error('notify-client fetch error:', phasesError || documentsError)
      return NextResponse.json({ error: 'Eroare la încărcarea proiectului' }, { status: 500 })
    }

    const phaseList = phases ?? []
    const phaseIds = phaseList.map(p => p.id)
    const { data: activities, error: activitiesError } = phaseIds.length
      ? await admin
          .from('project_activities')
          .select('id, name, visibility, client_notified_at, phase_id')
          .in('phase_id', phaseIds)
      : { data: [], error: null }

    if (activitiesError) {
      console.error('notify-client activities fetch error:', activitiesError)
      return NextResponse.json({ error: 'Eroare la încărcarea activităților' }, { status: 500 })
    }

    const phaseById = new Map(phaseList.map(p => [p.id, p]))
    const activityById = new Map((activities ?? []).map(a => [a.id, { ...a, phase: phaseById.get(a.phase_id) }]))

    const notifiablePhases = phaseList.filter(p => isClientVisiblePhase(p) && !p.client_notified_at)
    const notifiableActivities = (activities ?? []).filter(
      a => isClientVisibleActivity(activityById.get(a.id)) && !a.client_notified_at
    )
    const notifiableDocuments = (documents ?? []).filter(d => {
      const activity = d.activity_id ? activityById.get(d.activity_id) : null
      return isClientVisibleDocument({ ...d, activity }) && !d.client_notified_at
    })

    const totalCount = notifiablePhases.length + notifiableActivities.length + notifiableDocuments.length
    if (totalCount === 0) {
      return NextResponse.json({ error: 'Nu există elemente noi de anunțat clientului' }, { status: 400 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const projectUrl = `${appUrl}/projects/${projectId}`
    const safeProjectTitle = escapeHtml(project.title)
    const salut = client.full_name ? `Salut, ${escapeHtml(client.full_name)}!` : 'Salut!'

    const phaseItems = notifiablePhases.map(p => escapeHtml(p.name))
    const activityItems = notifiableActivities.map(a => {
      const phaseName = phaseById.get(a.phase_id)?.name
      return phaseName ? `${escapeHtml(a.name)} <span style="color:#6b7280;">— fază: ${escapeHtml(phaseName)}</span>` : escapeHtml(a.name)
    })
    const documentItems = notifiableDocuments.map(d => {
      const label = d.is_outgoing ? 'Document nou disponibil' : 'Cerere nouă de document'
      return `${escapeHtml(d.name)} <span style="color:#6b7280;">— ${label}</span>`
    })

    const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

    <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:32px 40px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Actualizări noi</h1>
      <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">${safeProjectTitle}</p>
    </div>

    <div style="padding:32px 40px;">
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">${salut}</p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;">
        Au fost publicate noutăți noi în proiectul <strong>${safeProjectTitle}</strong>:
      </p>

      ${listSection('Faze noi', phaseItems)}
      ${listSection('Activități noi', activityItems)}
      ${listSection('Documente noi', documentItems)}

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

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error: emailError } = await resend.emails.send({
      from: process.env.RESEND_CLIENT_NOTIFICATION_FROM_EMAIL ?? 'notificari@vorbaretul.ro',
      to: client.email,
      subject: `Actualizări noi în proiectul „${project.title}”`,
      html,
    })

    if (emailError) {
      console.error('notify-client Resend error:', emailError)
      return NextResponse.json({ error: 'Trimiterea emailului a eșuat. Reîncearcă.' }, { status: 502 })
    }

    const notifiedAt = new Date().toISOString()

    const [phasesUpdate, activitiesUpdate, documentsUpdate] = await Promise.all([
      notifiablePhases.length
        ? admin.from('project_phases').update({ client_notified_at: notifiedAt }).in('id', notifiablePhases.map(p => p.id))
        : Promise.resolve({ error: null }),
      notifiableActivities.length
        ? admin.from('project_activities').update({ client_notified_at: notifiedAt }).in('id', notifiableActivities.map(a => a.id))
        : Promise.resolve({ error: null }),
      notifiableDocuments.length
        ? admin.from('document_requirements').update({ client_notified_at: notifiedAt }).in('id', notifiableDocuments.map(d => d.id))
        : Promise.resolve({ error: null }),
    ])

    if (phasesUpdate.error || activitiesUpdate.error || documentsUpdate.error) {
      console.error('notify-client mark-as-notified error:', {
        phasesUpdate: phasesUpdate.error,
        activitiesUpdate: activitiesUpdate.error,
        documentsUpdate: documentsUpdate.error,
      })
    }

    await logAction({
      actorId: access.user.id,
      actionType: 'notify',
      entityType: 'project',
      entityId: projectId,
      entityName: project.title,
      newValues: {
        client_email: client.email,
        phases: notifiablePhases.map(p => p.id),
        activities: notifiableActivities.map(a => a.id),
        documents: notifiableDocuments.map(d => d.id),
      },
      description: `${access.profile.email || 'User'} a anunțat clientul despre ${totalCount} noutăți publicate în proiectul "${project.title}"`,
      request,
    })

    return NextResponse.json({
      ok: true,
      notified: {
        phases: notifiablePhases.length,
        activities: notifiableActivities.length,
        documents: notifiableDocuments.length,
      },
    })
  } catch (e: any) {
    console.error('notify-client exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
