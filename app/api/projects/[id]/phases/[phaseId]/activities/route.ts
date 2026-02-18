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

// GET /api/projects/[id]/phases/[phaseId]/activities
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId, phaseId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: activities, error } = await supabaseAdmin
      .from('project_activities')
      .select('*')
      .eq('phase_id', phaseId)
      .order('order_index', { ascending: true })

    if (error) throw error

    return NextResponse.json({ activities: activities || [] })
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
        status: status || 'pending'
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ activity }, { status: 201 })
  } catch (error: any) {
    console.error('POST activity error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}