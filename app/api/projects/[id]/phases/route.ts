/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/projects/[id]/phases - Lista faze cu activități și documente
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Fetch phases
    const { data: phases, error: phasesError } = await supabaseAdmin
      .from('project_phases')
      .select(`
        *,
        project_status:project_statuses(id, name, slug, color, icon, order_index)
      `)
      .eq('project_id', projectId)
      .order('order_index', { ascending: true })

    if (phasesError) throw phasesError

    // Fetch activities for each phase
    const phasesWithActivities = await Promise.all(
      (phases || []).map(async (phase) => {
        const { data: activities } = await supabaseAdmin
          .from('project_activities')
          .select('*')
          .eq('phase_id', phase.id)
          .order('order_index', { ascending: true })

        // Fetch documents for each activity
        const activitiesWithDocs = await Promise.all(
          (activities || []).map(async (activity) => {
            const { data: docs } = await supabaseAdmin
              .from('activity_document_requirements')
              .select('*')
              .eq('activity_id', activity.id)
              .order('created_at', { ascending: true })

            return { ...activity, document_requirements: docs || [] }
          })
        )

        return { ...phase, activities: activitiesWithDocs }
      })
    )

    return NextResponse.json({ phases: phasesWithActivities })
  } catch (error: any) {
    console.error('GET /api/projects/[id]/phases error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/projects/[id]/phases - Creare fază nouă
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: projectId } = await params
    
    const auth = await requireProjectAccess(req, projectId)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Doar admin și consultant pot crea faze
    if (auth.access.role === 'client') {
      return NextResponse.json({ error: 'Nu ai permisiunea să creezi faze' }, { status: 403 })
    }

    const body = await req.json()
    const { name, description, project_status_id, order_index, status } = body

    if (!name) {
      return NextResponse.json({ error: 'Numele este obligatoriu' }, { status: 400 })
    }

    // Generate slug
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    // Calculate order_index if not provided
    let finalOrderIndex = order_index
    if (!finalOrderIndex) {
      const { data: maxOrder } = await supabaseAdmin
        .from('project_phases')
        .select('order_index')
        .eq('project_id', projectId)
        .order('order_index', { ascending: false })
        .limit(1)
        .single()
      
      finalOrderIndex = (maxOrder?.order_index || 0) + 1
    }

    const { data: phase, error } = await supabaseAdmin
      .from('project_phases')
      .insert({
        project_id: projectId,
        name,
        slug,
        description: description || null,
        project_status_id: project_status_id || null,
        order_index: finalOrderIndex,
        status: status || 'pending'
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ phase }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/phases error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}