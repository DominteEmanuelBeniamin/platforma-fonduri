/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { escapeHtml, resendFromAddress, sanitizeHeaderText } from '@/app/api/_utils/email'
import { blockersIntroducedBy, publishBlockedError, publishBlockers } from '@/lib/publish-rules'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function loadProjectTitle(projectId: string) {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('title')
    .eq('id', projectId)
    .maybeSingle()
  return data?.title ?? projectId
}

// Trimite email consultantului nou atribuit (erorile nu blochează salvarea)
async function sendActivityAssignedEmail(params: {
  consultantId: string
  activityName: string
  phaseName: string
  projectId: string
  projectTitle: string
  deadlineAt: string | null
}) {
  try {
    const { data: consultant } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email')
      .eq('id', params.consultantId)
      .maybeSingle()

    if (!consultant?.email) return

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

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error: emailError } = await resend.emails.send({
      from: resendFromAddress(),
      to: consultant.email,
      subject: sanitizeHeaderText(`Ți-a fost atribuită o activitate nouă — ${params.projectTitle}`),
      html,
    })
    if (emailError) {
      console.error('Resend error:', emailError)
    }
  } catch (emailError) {
    console.error('Activity assigned email send error (non-blocking):', emailError)
  }
}

interface RouteParams {
  params: Promise<{ id: string; phaseId: string; activityId: string }>
}

// PATCH /api/projects/[id]/phases/[phaseId]/activities/[activityId]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId, activityId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (auth.access.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea' }, { status: 403 })
    }

    const body = await req.json()
    const { name, description, order_index, status, assigned_to, deadline_at, visibility } = body

    if (visibility !== undefined && visibility !== 'published') {
      return NextResponse.json({ error: 'Invalid visibility transition' }, { status: 400 })
    }

    // assigned_to trebuie să fie string (UUID), null sau omis — ca la document-requests.
    // Altfel un tip greșit ajunge până în .eq() și iese ca 500 în loc de 400.
    if (assigned_to !== undefined && assigned_to !== null && typeof assigned_to !== 'string') {
      return NextResponse.json({ error: 'assigned_to trebuie să fie un UUID sau null' }, { status: 400 })
    }

    // Același tratament pentru deadline_at: o dată nevalidă trecea nefiltrată
    // până în Postgres și ieșea ca 500.
    if (deadline_at !== undefined && deadline_at !== null && deadline_at !== '') {
      if (typeof deadline_at !== 'string' || Number.isNaN(Date.parse(deadline_at))) {
        return NextResponse.json({ error: 'deadline_at trebuie să fie o dată validă sau null' }, { status: 400 })
      }
    }

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (order_index !== undefined) updateData.order_index = order_index
    if (status !== undefined) updateData.status = status
    if (assigned_to !== undefined) updateData.assigned_to = assigned_to
    if (deadline_at !== undefined) updateData.deadline_at = deadline_at || null

    const { data: before } = await supabaseAdmin
      .from('project_activities')
      .select('*')
      .eq('id', activityId)
      .eq('phase_id', phaseId)
      .maybeSingle()

    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: phase } = await supabaseAdmin
      .from('project_phases')
      .select('id, name')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!phase) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Dacă se atribuie cuiva, verifică că este consultant membru al proiectului
    if (assigned_to !== undefined && assigned_to !== null) {
      const { data: membership, error: memberError } = await supabaseAdmin
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('consultant_id', assigned_to)
        .maybeSingle()

      if (memberError) {
        console.error('PATCH activity membership error:', memberError)
        return NextResponse.json({ error: 'Eroare la verificarea membrului' }, { status: 500 })
      }
      if (!membership) {
        return NextResponse.json(
          { error: 'Consultantul nu este membru al acestui proiect' },
          { status: 400 }
        )
      }
    }

    if (visibility === 'published' && before.visibility !== 'draft') {
      return NextResponse.json({ error: 'Activity is already published' }, { status: 400 })
    }

    // #70 — o activitate se publică doar completă. Verificarea stă înaintea
    // oricărei scrieri, ca o cerere respinsă să nu modifice parțial rândul.
    const publishState = {
      kind: 'activity' as const,
      currentDeadline: before.deadline_at,
      incomingDeadline: deadline_at,
      currentAssignee: before.assigned_to,
      incomingAssignee: assigned_to,
    }

    if (visibility === 'published') {
      const blockers = publishBlockers(publishState)
      if (blockers.length > 0) {
        return NextResponse.json(publishBlockedError(blockers), { status: 400 })
      }
    } else if (before.visibility === 'published') {
      // Deja publicată: regula nu se cere retroactiv — cele publicate înainte
      // de #70 rămân editabile — dar ce e completat nu poate fi golit.
      const removed = blockersIntroducedBy(publishState)
      if (removed.length > 0) {
        return NextResponse.json(
          publishBlockedError(removed, { alreadyPublished: true }),
          { status: 400 },
        )
      }
    }
    if (visibility === 'published') updateData.visibility = 'published'

    const { data: activity, error } = await supabaseAdmin
      .from('project_activities')
      .update(updateData)
      .eq('id', activityId)
      .eq('phase_id', phaseId)
      .select()
      .single()

    if (error) throw error

    const projectTitle = await loadProjectTitle(projectId)

    await logAction({
      actorId: auth.user.id,
      actionType: 'update',
      entityType: 'project_activity',
      entityId: activityId,
      entityName: activity.name,
      oldValues: before ? { ...before, project_title: projectTitle } : null,
      newValues: { ...updateData, project_id: projectId, project_title: projectTitle },
      description: `Modificare activitate "${activity.name}" in proiectul "${projectTitle}"`,
      request: req,
    })

    if (
      assigned_to !== undefined &&
      assigned_to !== null &&
      assigned_to !== before.assigned_to
    ) {
      await sendActivityAssignedEmail({
        consultantId: assigned_to,
        activityName: activity.name,
        phaseName: phase.name,
        projectId,
        projectTitle,
        deadlineAt: activity.deadline_at,
      })
    }

    return NextResponse.json({ activity })
  } catch (error: any) {
    console.error('PATCH activity error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/projects/[id]/phases/[phaseId]/activities/[activityId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId, activityId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (auth.access.role !== 'admin') {
      return NextResponse.json({ error: 'Doar adminii pot șterge' }, { status: 403 })
    }

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('project_activities')
      .select('*')
      .eq('id', activityId)
      .eq('phase_id', phaseId)
      .maybeSingle()

    if (beforeError) throw beforeError
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: phase, error: phaseError } = await supabaseAdmin
      .from('project_phases')
      .select('id')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (phaseError) throw phaseError
    if (!phase) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: deletionData, error: deletionError } = await supabaseAdmin.rpc(
      'delete_project_activity_preserving_requests',
      { project_id: projectId, phase_id: phaseId, activity_id: activityId },
    )

    if (deletionError) {
      if (deletionError.code === 'P0002') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      throw deletionError
    }

    const deletion = (Array.isArray(deletionData) ? deletionData[0] : deletionData) as {
      deleted: boolean
      moved_requests: number
      demoted_requests: number
    } | null

    if (!deletion) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const deletionSummary = {
      deleted_activities: deletion.deleted ? 1 : 0,
      moved_requests: Number(deletion.moved_requests ?? 0),
      demoted_requests: Number(deletion.demoted_requests ?? 0),
    }

    const projectTitle = await loadProjectTitle(projectId)

    await logAction({
      actorId: auth.user.id,
      actionType: 'delete',
      entityType: 'project_activity',
      entityId: activityId,
      entityName: before?.name ?? activityId,
      oldValues: before ? { ...before, project_title: projectTitle } : null,
      newValues: { project_id: projectId, project_title: projectTitle, ...deletionSummary },
      description: `Stergere activitate "${before?.name ?? activityId}" din proiectul "${projectTitle}"; ${deletionSummary.moved_requests} cereri mutate, ${deletionSummary.demoted_requests} cereri trecute in pregatire`,
      request: req,
    })

    return NextResponse.json({ success: true, deleted: deletion.deleted, ...deletionSummary })
  } catch (error: any) {
    console.error('DELETE activity error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
