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
  params: Promise<{ id: string }>
}

// POST /api/projects/[id]/phases/reorder - Reordonare în bloc a fazelor
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId } = await params

    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Doar admin și consultant pot reordona faze
    if (auth.access.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea să reordonezi faze' }, { status: 403 })
    }

    const body = await req.json()
    const { orders } = body // Array de { id, order_index }

    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json({ error: 'Format invalid' }, { status: 400 })
    }

    // Update fiecare fază cu noua ordine, scopat pe proiect (id-uri străine = no-op)
    for (const item of orders) {
      const { error } = await supabaseAdmin
        .from('project_phases')
        .update({ order_index: item.order_index })
        .eq('id', item.id)
        .eq('project_id', projectId)

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
      entityType: 'phase_reorder',
      entityId: null,
      entityName: 'Reordonare faze',
      newValues: { order: orders, project_id: projectId },
      description: `Reordonare a ${orders.length} faze în proiectul "${projectTitle}"`,
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/phases/reorder error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
