/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { isClientVisibleActivity, isClientVisiblePhase } from '@/lib/client-visibility'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>
}

// GET /api/projects/[id]/phases/[phaseId]/activities
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: phase } = await supabaseAdmin
      .from('project_phases')
      .select('id, visibility')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!phase || (auth.access.role === 'client' && !isClientVisiblePhase(phase))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: activities, error } = await supabaseAdmin
      .from('project_activities')
      .select('*')
      .eq('phase_id', phaseId)
      .order('order_index', { ascending: true })

    if (error) throw error

    return NextResponse.json({
      activities: auth.access.role === 'client'
        ? (activities || []).filter(activity => isClientVisibleActivity({ ...activity, phase }))
        : activities || [],
    })
  } catch (error: any) {
    console.error('GET activities error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/projects/[id]/phases/[phaseId]/activities
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (auth.access.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea' }, { status: 403 })
    }

    const { data: phase } = await supabaseAdmin
      .from('project_phases')
      .select('id')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!phase) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const { name, description, order_index, status } = body

    if (!name) {
      return NextResponse.json({ error: 'Numele este obligatoriu' }, { status: 400 })
    }

    let finalOrderIndex = order_index
    if (!finalOrderIndex) {
      const { data: maxOrder } = await supabaseAdmin
        .from('project_activities')
        .select('order_index')
        .eq('phase_id', phaseId)
        .order('order_index', { ascending: false })
        .limit(1)
        .single()
      
      finalOrderIndex = (maxOrder?.order_index || 0) + 1
    }

    const { data: activity, error } = await supabaseAdmin
      .from('project_activities')
      .insert({
        phase_id: phaseId,
        name,
        description: description || null,
        order_index: finalOrderIndex,
        status: status || 'pending',
        visibility: 'draft',
      })
      .select()
      .single()

    if (error) throw error

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
      newValues: { ...activity, project_id: projectId, project_title: projectTitle },
      description: `Creare activitate "${activity.name}" in proiectul "${projectTitle}"`,
      request: req,
    })

    return NextResponse.json({ activity }, { status: 201 })
  } catch (error: any) {
    console.error('POST activity error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
