/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { escapeHtml, resendFromAddress, sanitizeHeaderText } from '@/app/api/_utils/email'
import { isClientVisibleActivity, isClientVisibleDocument, isClientVisiblePhase } from '@/lib/client-visibility'

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
//
// Elementele sunt "revendicate" (client_notified_at setat) ÎNAINTE de trimitere,
// cu un update condiționat pe `client_notified_at is null` — asta face revendicarea
// atomică per rând la nivel de DB, deci două cereri concurente (dublu-click, două
// tab-uri) nu pot revendica și trimite digest pentru aceleași elemente de două ori.
// Dacă trimiterea email-ului eșuează, revendicarea e anulată explicit, ca elementele
// să rămână "de notificat" pentru următoarea încercare.
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
      .select('id, title, client:profiles!projects_client_id_fkey(id, full_name, email)')
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
    const activitiesWithPhase = (activities ?? []).map(a => ({ ...a, phase: phaseById.get(a.phase_id) }))
    const activityById = new Map(activitiesWithPhase.map(a => [a.id, a]))

    const candidatePhaseIds = phaseList
      .filter(p => isClientVisiblePhase(p) && !p.client_notified_at)
      .map(p => p.id)
    const candidateActivityIds = activitiesWithPhase
      .filter(a => isClientVisibleActivity(a) && !a.client_notified_at)
      .map(a => a.id)
    const candidateDocumentIds = (documents ?? [])
      .filter(d => isClientVisibleDocument({ ...d, activity: d.activity_id ? activityById.get(d.activity_id) : null }) && !d.client_notified_at)
      .map(d => d.id)

    if (candidatePhaseIds.length + candidateActivityIds.length + candidateDocumentIds.length === 0) {
      return NextResponse.json({ error: 'Nu există elemente noi de anunțat clientului' }, { status: 400 })
    }

    const notifiedAt = new Date().toISOString()

    // Revendicare atomică: update-ul condiționat pe `client_notified_at is null`
    // returnează doar rândurile pe care CHIAR le-am revendicat noi — dacă o cerere
    // concurentă le-a luat deja, nu mai apar aici.
    const [claimedPhasesRes, claimedActivitiesRes, claimedDocumentsRes] = await Promise.all([
      candidatePhaseIds.length
        ? admin.from('project_phases').update({ client_notified_at: notifiedAt }).in('id', candidatePhaseIds).is('client_notified_at', null).select('id, name')
        : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      candidateActivityIds.length
        ? admin.from('project_activities').update({ client_notified_at: notifiedAt }).in('id', candidateActivityIds).is('client_notified_at', null).select('id, name, phase_id')
        : Promise.resolve({ data: [] as { id: string; name: string; phase_id: string }[], error: null }),
      candidateDocumentIds.length
        ? admin.from('document_requirements').update({ client_notified_at: notifiedAt }).in('id', candidateDocumentIds).is('client_notified_at', null).select('id, name, is_outgoing')
        : Promise.resolve({ data: [] as { id: string; name: string; is_outgoing: boolean }[], error: null }),
    ])

    const claimedPhases = claimedPhasesRes.data ?? []
    const claimedActivities = claimedActivitiesRes.data ?? []
    const claimedDocuments = claimedDocumentsRes.data ?? []

    // Anulează revendicarea. Dacă ASTA eșuează, elementele rămân marcate ca notificate
    // fără să fi plecat vreun email — clientul n-ar mai afla niciodată despre ele. E cel
    // mai prost rezultat posibil aici, deci se loghează cu id-uri (reparabil manual) și
    // se semnalează apelantului, nu se înghite.
    const rollbackClaim = async () => {
      const [phasesRes, activitiesRes, documentsRes] = await Promise.all([
        claimedPhases.length
          ? admin.from('project_phases').update({ client_notified_at: null }).in('id', claimedPhases.map(p => p.id))
          : Promise.resolve({ error: null }),
        claimedActivities.length
          ? admin.from('project_activities').update({ client_notified_at: null }).in('id', claimedActivities.map(a => a.id))
          : Promise.resolve({ error: null }),
        claimedDocuments.length
          ? admin.from('document_requirements').update({ client_notified_at: null }).in('id', claimedDocuments.map(d => d.id))
          : Promise.resolve({ error: null }),
      ])

      if (phasesRes.error || activitiesRes.error || documentsRes.error) {
        console.error('notify-client ROLLBACK FAILED — elemente marcate ca notificate fără email trimis:', {
          phases: { error: phasesRes.error, ids: claimedPhases.map(p => p.id) },
          activities: { error: activitiesRes.error, ids: claimedActivities.map(a => a.id) },
          documents: { error: documentsRes.error, ids: claimedDocuments.map(d => d.id) },
        })
        return false
      }
      return true
    }

    // Răspunsul de eroare după un rollback: dacă rollback-ul n-a reușit, coada NU mai e
    // intactă, iar consultantul trebuie să știe că o reîncercare simplă nu e suficientă.
    const failAfterRollback = async (status: number, message: string) => {
      const rolledBack = await rollbackClaim()
      return NextResponse.json(
        {
          error: rolledBack
            ? message
            : `${message} În plus, marcajul intern nu a putut fi anulat — anunță un administrator, unele noutăți nu vor mai apărea la următoarea trimitere.`,
          ...(rolledBack ? {} : { rollbackFailed: true }),
        },
        { status }
      )
    }

    if (claimedPhasesRes.error || claimedActivitiesRes.error || claimedDocumentsRes.error) {
      console.error('notify-client claim error:', {
        phases: claimedPhasesRes.error,
        activities: claimedActivitiesRes.error,
        documents: claimedDocumentsRes.error,
      })
      return failAfterRollback(500, 'Eroare la pregătirea notificării. Reîncearcă.')
    }

    const totalClaimed = claimedPhases.length + claimedActivities.length + claimedDocuments.length
    if (totalClaimed === 0) {
      // Altcineva a revendicat deja aceleași elemente între timp (dublu-click / alt tab).
      return NextResponse.json({ error: 'Clientul a fost deja anunțat despre aceste noutăți' }, { status: 409 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const projectUrl = `${appUrl}/projects/${projectId}`
    const safeProjectTitle = escapeHtml(project.title)
    const salut = client.full_name ? `Salut, ${escapeHtml(client.full_name)}!` : 'Salut!'

    const phaseItems = claimedPhases.map(p => escapeHtml(p.name))
    const activityItems = claimedActivities.map(a => {
      const phaseName = phaseById.get(a.phase_id)?.name
      return phaseName ? `${escapeHtml(a.name)} <span style="color:#6b7280;">— fază: ${escapeHtml(phaseName)}</span>` : escapeHtml(a.name)
    })
    const documentItems = claimedDocuments.map(d => {
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

    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const { error: emailError } = await resend.emails.send({
        from: resendFromAddress('client'),
        to: client.email,
        subject: `Actualizări noi în proiectul „${sanitizeHeaderText(project.title)}”`,
        html,
      })

      if (emailError) {
        console.error('notify-client Resend error:', emailError)
        return failAfterRollback(502, 'Trimiterea emailului a eșuat. Reîncearcă.')
      }
    } catch (emailException) {
      console.error('notify-client Resend exception:', emailException)
      return failAfterRollback(502, 'Trimiterea emailului a eșuat. Reîncearcă.')
    }

    // Emailul a plecat deja și elementele sunt marcate — un audit log care crapă nu mai
    // are voie să transforme asta în 500, altfel consultantul crede că n-a mers nimic și
    // reîncearcă (a doua oară primește „nu există elemente noi").
    try {
      await logAction({
        actorId: access.user.id,
        actionType: 'notify',
        entityType: 'project',
        entityId: projectId,
        entityName: project.title,
        newValues: {
          client_email: client.email,
          phases: claimedPhases.map(p => p.id),
          activities: claimedActivities.map(a => a.id),
          documents: claimedDocuments.map(d => d.id),
        },
        description: `${access.profile.email || 'User'} a anunțat clientul despre ${totalClaimed} noutăți publicate în proiectul "${project.title}"`,
        request,
      })
    } catch (auditError) {
      console.error('notify-client audit log error (email deja trimis):', auditError)
    }

    return NextResponse.json({
      ok: true,
      notified: {
        phases: claimedPhases.length,
        activities: claimedActivities.length,
        documents: claimedDocuments.length,
      },
    })
  } catch (e: any) {
    console.error('notify-client exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
