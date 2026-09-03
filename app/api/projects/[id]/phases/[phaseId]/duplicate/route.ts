/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { duplicatePhase } from '@/app/api/_utils/duplicate-project-items'
import { buildCopyName } from '@/lib/duplicate-name'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>
}

// POST /api/projects/[id]/phases/[phaseId]/duplicate - Duplicare fază cu tot ce conține (#15)
//
// Erorile pleacă și pe `message`, nu doar pe `error`: `apiFetch` rescrie `error`
// cu un text generic, deci motivul real ar rămâne pe server (#70).
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId } = await params

    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error, message: auth.error }, { status: auth.status })
    }

    // Duplicarea e o creare, deci merge după aceleași drepturi ca adăugarea (#10)
    if (auth.access.role === 'client') {
      return NextResponse.json(
        { error: 'Nu ai permisiunea să duplici faze', message: 'Nu ai permisiunea să duplici faze' },
        { status: 403 },
      )
    }

    const { data: phases, error: phasesError } = await supabaseAdmin
      .from('project_phases')
      .select('*')
      .eq('project_id', projectId)

    if (phasesError) throw phasesError

    const source = (phases ?? []).find(phase => phase.id === phaseId)
    if (!source) {
      return NextResponse.json(
        { error: 'Faza nu există în acest proiect', message: 'Faza nu există în acest proiect' },
        { status: 404 },
      )
    }

    const name = buildCopyName(source.name, (phases ?? []).map(phase => phase.name))

    const { phase, counts, audit } = await duplicatePhase(supabaseAdmin, {
      projectId,
      sourcePhase: source,
      name,
      actorId: auth.user.id,
    })

    const { data: projectRow } = await supabaseAdmin
      .from('projects')
      .select('title')
      .eq('id', projectId)
      .maybeSingle()
    const projectTitle = projectRow?.title ?? projectId

    await logAction({
      actorId: auth.user.id,
      actionType: 'create',
      entityType: 'project_phase',
      entityId: phase.id,
      entityName: phase.name,
      newValues: {
        ...phase,
        project_id: projectId,
        project_title: projectTitle,
        source_phase_id: source.id,
        source_phase_name: source.name,
        activities_created: counts.activities,
        document_requests_created: counts.documentRequests,
        created_by: auth.user.id,
        duplication: {
          source_kind: 'persistent',
          source_entity_type: 'project_phase',
          source_id: source.id,
          source_name: source.name,
        },
      },
      description: `Duplicare faza "${source.name}" -> "${phase.name}" in proiectul "${projectTitle}" (${counts.activities} activitati, ${counts.documentRequests} cereri de documente)`,
      request: req,
    })

    for (const item of audit.activities) {
      await logAction({
        actorId: auth.user.id,
        actionType: 'create',
        entityType: 'project_activity',
        entityId: item.copyId,
        entityName: item.copyName,
        newValues: {
          project_id: projectId,
          project_title: projectTitle,
          phase_id: item.phaseId,
          phase_name: item.phaseName,
          source_activity_id: item.sourceId,
          source_activity_name: item.sourceName,
          created_by: auth.user.id,
          duplication: {
            source_kind: 'persistent',
            source_entity_type: 'project_activity',
            source_id: item.sourceId,
            source_name: item.sourceName,
          },
        },
        description: `Duplicare activitate "${item.sourceName}" -> "${item.copyName}" în faza "${item.phaseName ?? phase.name}" (proiect "${projectTitle}")`,
        request: req,
      })
    }

    for (const item of audit.documentRequests) {
      await logAction({
        actorId: auth.user.id,
        actionType: 'create',
        entityType: 'document_request',
        entityId: item.copyId,
        entityName: item.copyName,
        newValues: {
          project_id: projectId,
          project_title: projectTitle,
          phase_id: item.phaseId,
          phase_name: item.phaseName,
          activity_id: item.activityId,
          activity_name: item.activityName,
          source_activity_id: item.sourceActivityId,
          source_activity_name: item.sourceActivityName,
          created_by: auth.user.id,
          duplication: {
            source_kind: 'persistent',
            source_entity_type: 'document_request',
            source_id: item.sourceId,
            source_name: item.sourceName,
          },
        },
        description: `Duplicare cerere de document "${item.sourceName}" -> "${item.copyName}" în activitatea "${item.activityName ?? ''}" (proiect "${projectTitle}")`,
        request: req,
      })
    }

    return NextResponse.json({
      phase,
      activities_created: counts.activities,
      document_requests_created: counts.documentRequests,
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/phases/[phaseId]/duplicate error:', error)
    return NextResponse.json({ error: error.message, message: error.message }, { status: 500 })
  }
}
