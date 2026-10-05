/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canManageProject, requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { sendActivityAssignedEmail } from '@/app/api/_utils/activity-assignment-email'
import { blockersIntroducedBy, publishBlockedError, publishBlockers } from '@/lib/publish-rules'
import { buildAssignmentEmailIdempotencyKey, isRealAssignmentChange } from '@/lib/notification-utils'
import { STATUS_PATCH_MESSAGE } from '@/lib/completion'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function loadProjectTitle(projectId: string) {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('title')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw error
  return data?.title ?? projectId
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
    const isPublishing = visibility === 'published'

    if (visibility !== undefined && visibility !== 'published') {
      return NextResponse.json({ error: 'Invalid visibility transition' }, { status: 400 })
    }

    // Finalizarea are rute proprii (/complete, /reopen), cu gardă de manager
    // (D1), update condiționat și audit (#109). PATCH-ul nu mai e un al doilea
    // drum spre ea.
    if (status !== undefined) {
      return NextResponse.json({ error: 'status is changed only via /complete and /reopen', message: STATUS_PATCH_MESSAGE }, { status: 400 })
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
    if (assigned_to !== undefined) updateData.assigned_to = assigned_to
    if (deadline_at !== undefined) updateData.deadline_at = deadline_at || null

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
      .select('id, name')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (phaseError) throw phaseError
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

    if (isPublishing && before.visibility !== 'draft') {
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

    if (isPublishing) {
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
    if (isPublishing) updateData.visibility = 'published'

    const assignmentChanged = assigned_to !== undefined && assigned_to !== before.assigned_to
    if (assignmentChanged) {
      updateData.updated_at = new Date().toISOString()
      // Triggerul de notificare rulează cu clientul de service, unde `auth.uid()`
      // e null. Autorul călătorește cu rândul, în aceeași scriere.
      updateData.assigned_by = auth.user.id
    }
    const projectTitle = await loadProjectTitle(projectId)
    let activityUpdate = supabaseAdmin
      .from('project_activities')
      .update(updateData)
      .eq('id', activityId)
      .eq('phase_id', phaseId)
    if (assignmentChanged) {
      activityUpdate = before.assigned_to === null
        ? activityUpdate.is('assigned_to', null)
        : activityUpdate.eq('assigned_to', before.assigned_to)
    }
    const { data: activity, error } = await activityUpdate.select().maybeSingle()

    if (error) throw error
    if (!activity) {
      return NextResponse.json(
        { error: assignmentChanged ? 'Activitatea a fost modificată între timp. Reîncarcă și încearcă din nou.' : 'Activitatea nu mai există' },
        { status: assignmentChanged ? 409 : 404 },
      )
    }

    if (isRealAssignmentChange(before.assigned_to, assigned_to)) {
      const idempotencyKey = buildAssignmentEmailIdempotencyKey({
        projectId,
        entityType: 'activity',
        entityId: activityId,
        recipientId: assigned_to,
        version: activity.updated_at,
      })
      await sendActivityAssignedEmail({
        consultantId: assigned_to,
        activityName: activity.name,
        phaseName: phase.name,
        projectId,
        projectTitle,
        deadlineAt: activity.deadline_at,
        idempotencyKey,
      })
    }

    await logAction({
      actorId: auth.user.id,
      actionType: isPublishing ? 'publish' : 'update',
      entityType: 'project_activity',
      entityId: activityId,
      entityName: activity.name,
      oldValues: before ? { ...before, project_title: projectTitle } : null,
      newValues: { ...updateData, project_id: projectId, project_title: projectTitle },
      description: `${isPublishing ? 'Publicare' : 'Modificare'} activitate "${activity.name}" în proiectul "${projectTitle}"`,
      request: req,
    })

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

    if (!canManageProject(auth.access)) {
      return NextResponse.json({ error: 'Doar adminii și consultanții seniori pot șterge' }, { status: 403 })
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
