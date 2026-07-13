/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ templateId: string }>
}

// POST /api/admin/templates/[templateId]/duplicate
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { templateId } = await params

    const { data: original, error: fetchError } = await supabaseAdmin
      .from('project_templates')
      .select('*')
      .eq('id', templateId)
      .single()

    if (fetchError || !original) {
      return NextResponse.json({ error: 'Template negăsit' }, { status: 404 })
    }

    let newSlug = `${original.slug}-copy`
    let counter = 1
    while (true) {
      const { data: existing } = await supabaseAdmin
        .from('project_templates')
        .select('id')
        .eq('slug', newSlug)
        .single()
      
      if (!existing) break
      newSlug = `${original.slug}-copy-${counter}`
      counter++
    }

    const { data: newTemplate, error: createError } = await supabaseAdmin
      .from('project_templates')
      .insert({
        name: `${original.name} (Copie)`,
        slug: newSlug,
        description: original.description,
        measure_id: original.measure_id,
        is_default: false,
        is_active: true,
        created_by: auth.profile.id
      })
      .select()
      .single()

    if (createError) throw createError

    const { data: phases } = await supabaseAdmin
      .from('template_phases')
      .select('*')
      .eq('template_id', templateId)
      .order('order_index')

    for (const phase of phases || []) {
      const { data: newPhase } = await supabaseAdmin
        .from('template_phases')
        .insert({
          template_id: newTemplate.id,
          project_status_id: phase.project_status_id,
          name: phase.name,
          slug: phase.slug,
          description: phase.description,
          order_index: phase.order_index,
          estimated_days: phase.estimated_days,
          is_active: true
        })
        .select()
        .single()

      if (!newPhase) continue

      const { data: activities } = await supabaseAdmin
        .from('template_activities')
        .select('*')
        .eq('template_phase_id', phase.id)
        .order('order_index')

      for (const activity of activities || []) {
        const { data: newActivity } = await supabaseAdmin
          .from('template_activities')
          .insert({
            template_phase_id: newPhase.id,
            name: activity.name,
            description: activity.description,
            order_index: activity.order_index,
            estimated_days: activity.estimated_days,
            is_active: true
          })
          .select()
          .single()

        if (!newActivity) continue

        const { data: docs } = await supabaseAdmin
          .from('template_document_requirements')
          .select('*')
          .eq('template_activity_id', activity.id)
          .eq('is_active', true)
          .order('order_index')

        for (const doc of docs || []) {
          await supabaseAdmin
            .from('template_document_requirements')
            .insert({
              template_activity_id: newActivity.id,
              name: doc.name,
              description: doc.description,
              is_mandatory: doc.is_mandatory,
              requirement_type: doc.requirement_type,
              order_index: doc.order_index,
              attachment_path: doc.attachment_path,
              attachment_original_name: doc.attachment_original_name,
              is_outgoing: Boolean(doc.is_outgoing),
              is_active: true,
            })
        }
      }
    }

    await logAction({
      actorId: auth.profile.id,
      actionType: 'create',
      entityType: 'template',
      entityId: newTemplate.id,
      entityName: newTemplate.name,
      newValues: {
        source_template_id: templateId,
        source_template_name: original.name,
        name: newTemplate.name,
        slug: newTemplate.slug,
      },
      description: `Duplicare sablon ${original.name} -> ${newTemplate.name}`,
      request: req,
    })

    return NextResponse.json({ template: newTemplate }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates/[templateId]/duplicate error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
