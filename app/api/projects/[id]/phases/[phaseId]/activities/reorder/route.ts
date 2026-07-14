/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>
}

// POST /api/projects/[id]/phases/[phaseId]/activities/reorder - Reordonare în bloc a activităților din fază
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId } = await params

    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Doar admin și consultant pot reordona activități
    if (auth.access.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea să reordonezi activități' }, { status: 403 })
    }

    // project_activities nu are project_id — verifică apartenența fazei la proiect
    const { data: phase } = await supabaseAdmin
      .from('project_phases')
      .select('id, name, project_id')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!phase) {
      return NextResponse.json({ error: 'Faza nu există în acest proiect' }, { status: 404 })
    }

    const body = await req.json()
    const { orders } = body // Array de { id, order_index }

    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json({ error: 'Format invalid' }, { status: 400 })
    }

    // Update fiecare activitate cu noua ordine, scopat pe fază (id-uri străine = no-op)
    for (const item of orders) {
      const { error } = await supabaseAdmin
        .from('project_activities')
        .update({ order_index: item.order_index })
        .eq('id', item.id)
        .eq('phase_id', phaseId)

      if (error) throw error
    }

    const { data: projectRow } = await supabaseAdmin
      .from('projects')
      .select('title')
      .eq('id', projectId)
      .maybeSingle()
    const projectTitle = projectRow?.title ?? projectId

    await logAction({
      actorId: auth.user.id,
      actionType: 'update',
      entityType: 'activity_reorder',
      entityId: null,
      entityName: 'Reordonare activități',
      newValues: { order: orders, project_id: projectId, phase_id: phaseId },
      description: `Reordonare a ${orders.length} activități în faza "${phase.name}" (proiect "${projectTitle}")`,
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/phases/[phaseId]/activities/reorder error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
