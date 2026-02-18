/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/admin/templates
export async function GET(req: NextRequest) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: templates, error: templatesError } = await supabaseAdmin
      .from('project_templates')
      .select(`
        *,
        measure:program_measures(name, program:programs(name))
      `)
      .order('created_at', { ascending: false })

    if (templatesError) throw templatesError

    const templatesWithDetails = await Promise.all(
      (templates || []).map(async (template) => {
        const { data: phases } = await supabaseAdmin
          .from('template_phases')
          .select(`
            *,
            project_status:project_statuses(id, name, slug, color, icon)
          `)
          .eq('template_id', template.id)
          .eq('is_active', true)
          .order('order_index', { ascending: true })

        const phasesWithActivities = await Promise.all(
          (phases || []).map(async (phase) => {
            const { data: activities } = await supabaseAdmin
              .from('template_activities')
              .select('*')
              .eq('template_phase_id', phase.id)
              .eq('is_active', true)
              .order('order_index', { ascending: true })

            const activitiesWithDocs = await Promise.all(
              (activities || []).map(async (activity) => {
                const { data: docs } = await supabaseAdmin
                  .from('template_document_requirements')
                  .select('*')
                  .eq('template_activity_id', activity.id)
                  .order('order_index', { ascending: true })

                return { ...activity, document_requirements: docs || [] }
              })
            )

            return { ...phase, activities: activitiesWithDocs }
          })
        )

        return { ...template, phases: phasesWithActivities }
      })
    )

    return NextResponse.json({ templates: templatesWithDetails })
  } catch (error: any) {
    console.error('GET /api/admin/templates error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/admin/templates
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json()
    const { name, slug, description, measure_id, is_default } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Numele și slug-ul sunt obligatorii' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('project_templates')
      .select('id')
      .eq('slug', slug)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Un template cu acest slug există deja' }, { status: 400 })
    }

    const { data: template, error } = await supabaseAdmin
      .from('project_templates')
      .insert({
        name,
        slug,
        description: description || null,
        measure_id: measure_id || null,
        is_default: is_default || false,
        is_active: true,
        created_by: auth.profile.id
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ template }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}