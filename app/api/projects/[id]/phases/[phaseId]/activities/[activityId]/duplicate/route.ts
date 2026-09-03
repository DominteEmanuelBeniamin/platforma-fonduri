/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { duplicateActivityAfterSource } from '@/app/api/_utils/duplicate-project-items'
import { buildCopyName } from '@/lib/duplicate-name'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string; phaseId: string; activityId: string }>
}

// POST /api/projects/[id]/phases/[phaseId]/activities/[activityId]/duplicate (#15)
//
// Erorile pleacă și pe `message`, nu doar pe `error`: `apiFetch` rescrie `error`
// cu un text generic, deci motivul real ar rămâne pe server (#70).
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId, activityId } = await params

    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error, message: auth.error }, { status: auth.status })
    }

    if (auth.access.role === 'client') {
      return NextResponse.json(
        { error: 'Nu ai permisiunea să duplici activități', message: 'Nu ai permisiunea să duplici activități' },
        { status: 403 },
      )
    }

    // project_activities nu are project_id — verifică apartenența fazei la proiect
    const { data: phase } = await supabaseAdmin
      .from('project_phases')
      .select('id, name')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!phase) {
      return NextResponse.json(
        { error: 'Faza nu există în acest proiect', message: 'Faza nu există în acest proiect' },
        { status: 404 },
      )
    }

    const { data: activities, error: activitiesError } = await supabaseAdmin
      .from('project_activities')
      .select('*')
      .eq('phase_id', phaseId)

    if (activitiesError) throw activitiesError

    const source = (activities ?? []).find(activity => activity.id === activityId)
    if (!source) {
      return NextResponse.json(
        { error: 'Activitatea nu există în această fază', message: 'Activitatea nu există în această fază' },
        { status: 404 },
      )
    }

    const name = buildCopyName(source.name, (activities ?? []).map(activity => activity.name))

    const { activity, documentRequests, audit } = await duplicateActivityAfterSource(supabaseAdmin, {
      projectId,
      phaseId,
      sourceActivity: source,
      name,
      actorId: auth.user.id,
      phaseName: phase.name,
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
      entityType: 'project_activity',
      entityId: activity.id,
      entityName: activity.name,
      newValues: {
        ...activity,
        project_id: projectId,
        project_title: projectTitle,
        phase_name: phase.name,
        source_activity_id: source.id,
        source_activity_name: source.name,
        document_requests_created: documentRequests.length,
        created_by: auth.user.id,
        duplication: {
          source_kind: 'persistent',
          source_entity_type: 'project_activity',
          source_id: source.id,
          source_name: source.name,
        },
      },
      description: `Duplicare activitate "${source.name}" -> "${activity.name}" in faza "${phase.name}" (proiect "${projectTitle}", ${documentRequests.length} cereri de documente)`,
      request: req,
    })

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
        description: `Duplicare cerere de document "${item.sourceName}" -> "${item.copyName}" în activitatea "${item.activityName ?? activity.name}" (proiect "${projectTitle}")`,
        request: req,
      })
    }

    return NextResponse.json({
      activity,
      document_requests_created: documentRequests.length,
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/phases/[phaseId]/activities/[activityId]/duplicate error:', error)
    return NextResponse.json({ error: error.message, message: error.message }, { status: 500 })
  }
}
