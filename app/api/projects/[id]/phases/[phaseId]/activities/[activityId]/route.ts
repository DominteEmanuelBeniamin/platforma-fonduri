/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'

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

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (order_index !== undefined) updateData.order_index = order_index
    if (status !== undefined) updateData.status = status
    if (assigned_to !== undefined) updateData.assigned_to = assigned_to
    if (deadline_at !== undefined) updateData.deadline_at = deadline_at ?? null

    const { data: before } = await supabaseAdmin
      .from('project_activities')
      .select('*')
      .eq('id', activityId)
      .eq('phase_id', phaseId)
      .maybeSingle()

    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: phase } = await supabaseAdmin
      .from('project_phases')
      .select('id')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!phase) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (visibility === 'published') {
      if (before.visibility !== 'draft') {
        return NextResponse.json({ error: 'Activity is already published' }, { status: 400 })
      }
      updateData.visibility = 'published'
    }

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

    const { data: before } = await supabaseAdmin
      .from('project_activities')
      .select('*')
      .eq('id', activityId)
      .eq('phase_id', phaseId)
      .maybeSingle()

    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: phase } = await supabaseAdmin
      .from('project_phases')
      .select('id')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!phase) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { error } = await supabaseAdmin
      .from('project_activities')
      .delete()
      .eq('id', activityId)
      .eq('phase_id', phaseId)

    if (error) throw error

    const projectTitle = await loadProjectTitle(projectId)

    await logAction({
      actorId: auth.user.id,
      actionType: 'delete',
      entityType: 'project_activity',
      entityId: activityId,
      entityName: before?.name ?? activityId,
      oldValues: before ? { ...before, project_title: projectTitle } : null,
      description: `Stergere activitate "${before?.name ?? activityId}" din proiectul "${projectTitle}"`,
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE activity error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
