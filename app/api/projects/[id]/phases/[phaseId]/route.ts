/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { isClientVisiblePhase } from '@/lib/client-visibility'

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
  params: Promise<{ id: string; phaseId: string }>
}

// GET /api/projects/[id]/phases/[phaseId]
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: phase, error } = await supabaseAdmin
      .from('project_phases')
      .select(`*, project_status:project_statuses(*)`)
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .single()

    if (error || !phase) {
      return NextResponse.json({ error: 'Fază negăsită' }, { status: 404 })
    }

    if (auth.access.role === 'client' && !isClientVisiblePhase(phase)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ phase })
  } catch (error: any) {
    console.error('GET /api/projects/[id]/phases/[phaseId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/projects/[id]/phases/[phaseId]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (auth.access.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea' }, { status: 403 })
    }

    const body = await req.json()
    const { name, description, project_status_id, order_index, status, visibility } = body

    if (visibility !== undefined && visibility !== 'published') {
      return NextResponse.json({ error: 'Invalid visibility transition' }, { status: 400 })
    }

    const updateData: Record<string, any> = {}
    // Numele se schimbă singur, fără slug: `(project_id, slug)` e unic, iar două
    // nume care se deosebesc doar prin diacritice sau punctuație dau același
    // slug — redenumirea ar pica cu 500, definitiv, pe un câmp pe care aplicația
    // nu-l citește nicăieri. Slug-ul rămâne cel de la creare (#15).
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (project_status_id !== undefined) updateData.project_status_id = project_status_id
    if (order_index !== undefined) updateData.order_index = order_index
    if (status !== undefined) {
      updateData.status = status
      if (status === 'in_progress' && !updateData.started_at) {
        updateData.started_at = new Date().toISOString()
      }
      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString()
      }
    }

    const { data: before } = await supabaseAdmin
      .from('project_phases')
      .select('*')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (visibility === 'published') {
      if (!before || before.visibility !== 'draft') {
        return NextResponse.json({ error: 'Phase is already published' }, { status: 400 })
      }
      updateData.visibility = 'published'
    }

    const { data: phase, error } = await supabaseAdmin
      .from('project_phases')
      .update(updateData)
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .select()
      .single()

    if (error) throw error

    const projectTitle = await loadProjectTitle(projectId)

    await logAction({
      actorId: auth.user.id,
      actionType: 'update',
      entityType: 'project_phase',
      entityId: phaseId,
      entityName: phase.name,
      oldValues: before ? { ...before, project_title: projectTitle } : null,
      newValues: { ...updateData, project_id: projectId, project_title: projectTitle },
      description: `Modificare faza "${phase.name}" in proiectul "${projectTitle}"`,
      request: req,
    })

    return NextResponse.json({ phase })
  } catch (error: any) {
    console.error('PATCH /api/projects/[id]/phases/[phaseId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/projects/[id]/phases/[phaseId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (auth.access.role !== 'admin') {
      return NextResponse.json({ error: 'Doar adminii pot șterge faze' }, { status: 403 })
    }

    const { data: before, error: beforeError } = await supabaseAdmin
      .from('project_phases')
      .select('*')
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (beforeError) throw beforeError
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: deletionData, error: deletionError } = await supabaseAdmin.rpc(
      'delete_project_phase_preserving_requests',
      { project_id: projectId, phase_id: phaseId },
    )

    if (deletionError) {
      if (deletionError.code === 'P0002') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      throw deletionError
    }

    const deletion = (Array.isArray(deletionData) ? deletionData[0] : deletionData) as {
      deleted: boolean
      deleted_activities: number
      moved_requests: number
      demoted_requests: number
    } | null

    if (!deletion) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const deletionSummary = {
      deleted_activities: Number(deletion.deleted_activities ?? 0),
      moved_requests: Number(deletion.moved_requests ?? 0),
      demoted_requests: Number(deletion.demoted_requests ?? 0),
    }

    const projectTitle = await loadProjectTitle(projectId)

    await logAction({
      actorId: auth.user.id,
      actionType: 'delete',
      entityType: 'project_phase',
      entityId: phaseId,
      entityName: before?.name ?? phaseId,
      oldValues: before ? { ...before, project_title: projectTitle } : null,
      newValues: { project_id: projectId, project_title: projectTitle, ...deletionSummary },
      description: `Stergere faza "${before?.name ?? phaseId}" din proiectul "${projectTitle}"; ${deletionSummary.deleted_activities} activitati sterse, ${deletionSummary.moved_requests} cereri mutate, ${deletionSummary.demoted_requests} cereri trecute in pregatire`,
      request: req,
    })

    return NextResponse.json({ success: true, deleted: deletion.deleted, ...deletionSummary })
  } catch (error: any) {
    console.error('DELETE /api/projects/[id]/phases/[phaseId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
