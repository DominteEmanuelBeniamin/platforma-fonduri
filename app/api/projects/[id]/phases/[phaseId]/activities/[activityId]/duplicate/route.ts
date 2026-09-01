/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { duplicateActivity, shiftActivitiesAfter } from '@/app/api/_utils/duplicate-project-items'
import { buildCopyName } from '@/lib/duplicate-name'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string; phaseId: string; activityId: string }>
}

// POST /api/projects/[id]/phases/[phaseId]/activities/[activityId]/duplicate (#15)
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId, activityId } = await params

    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (auth.access.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea să duplici activități' }, { status: 403 })
    }

    // project_activities nu are project_id — verifică apartenența fazei la proiect
    const { data: phase } = await supabaseAdmin
      .from('project_phases')
      .select('id, name')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!phase) {
      return NextResponse.json({ error: 'Faza nu există în acest proiect' }, { status: 404 })
    }

    const { data: activities, error: activitiesError } = await supabaseAdmin
      .from('project_activities')
      .select('*')
      .eq('phase_id', phaseId)

    if (activitiesError) throw activitiesError

    const source = (activities ?? []).find(activity => activity.id === activityId)
    if (!source) {
      return NextResponse.json({ error: 'Activitatea nu există în această fază' }, { status: 404 })
    }

    const sourceOrderIndex = source.order_index ?? 0
    const name = buildCopyName(source.name, (activities ?? []).map(activity => activity.name))

    await shiftActivitiesAfter(supabaseAdmin, phaseId, sourceOrderIndex)

    const { activity, documentRequests } = await duplicateActivity(supabaseAdmin, {
      projectId,
      targetPhaseId: phaseId,
      sourceActivity: source,
      name,
      orderIndex: sourceOrderIndex + 1,
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
        document_requests_created: documentRequests,
      },
      description: `Duplicare activitate "${source.name}" -> "${activity.name}" in faza "${phase.name}" (proiect "${projectTitle}", ${documentRequests} cereri de documente)`,
      request: req,
    })

    return NextResponse.json({
      activity,
      document_requests_created: documentRequests,
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/phases/[phaseId]/activities/[activityId]/duplicate error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
