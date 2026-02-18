/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    const { name, description, project_status_id, order_index, status } = body

    const updateData: Record<string, any> = {}
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

    const { data: phase, error } = await supabaseAdmin
      .from('project_phases')
      .update(updateData)
      .eq('id', phaseId)
      .eq('project_id', projectId)
      .select()
      .single()

    if (error) throw error

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

    const { error } = await supabaseAdmin
      .from('project_phases')
      .delete()
      .eq('id', phaseId)
      .eq('project_id', projectId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/projects/[id]/phases/[phaseId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}