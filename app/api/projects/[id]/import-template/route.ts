/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST /api/projects/[id]/import-template
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { id: projectId } = await params
    const body = await req.json()
    const { template_id } = body

    if (!template_id) {
      return NextResponse.json({ error: 'template_id este obligatoriu' }, { status: 400 })
    }

    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, title')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Proiect negăsit' }, { status: 404 })
    }

    const { data: existingPhases } = await supabaseAdmin
      .from('project_phases')
      .select('id')
      .eq('project_id', projectId)
      .limit(1)

    if (existingPhases && existingPhases.length > 0) {
      return NextResponse.json({ 
        error: 'Proiectul are deja faze.' 
      }, { status: 400 })
    }

    const { data: template, error: templateError } = await supabaseAdmin
      .from('project_templates')
      .select('id, name')
      .eq('id', template_id)
      .single()

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template negăsit' }, { status: 404 })
    }

    const { data: templatePhases } = await supabaseAdmin
      .from('template_phases')
      .select('*')
      .eq('template_id', template_id)
      .eq('is_active', true)
      .order('order_index')

    if (!templatePhases || templatePhases.length === 0) {
      return NextResponse.json({ error: 'Template-ul nu are faze' }, { status: 400 })
    }

    for (const tPhase of templatePhases) {
      const { data: newPhase, error: phaseError } = await supabaseAdmin
        .from('project_phases')
        .insert({
          project_id: projectId,
          project_status_id: tPhase.project_status_id,
          name: tPhase.name,
          slug: tPhase.slug,
          description: tPhase.description,
          order_index: tPhase.order_index,
          status: 'pending'
        })
        .select()
        .single()

      if (phaseError || !newPhase) continue

      const { data: templateActivities } = await supabaseAdmin
        .from('template_activities')
        .select('*')
        .eq('template_phase_id', tPhase.id)
        .eq('is_active', true)
        .order('order_index')

      for (const tActivity of templateActivities || []) {
        const { data: newActivity, error: activityError } = await supabaseAdmin
          .from('project_activities')
          .insert({
            phase_id: newPhase.id,
            name: tActivity.name,
            description: tActivity.description,
            order_index: tActivity.order_index,
            status: 'pending'
          })
          .select()
          .single()

        if (activityError || !newActivity) continue

        const { data: templateDocs } = await supabaseAdmin
          .from('template_document_requirements')
          .select('*')
          .eq('template_activity_id', tActivity.id)
          .order('order_index')

        for (const tDoc of templateDocs || []) {
          await supabaseAdmin
            .from('document_requirements')
            .insert({
              project_id: projectId,
              activity_id: newActivity.id,
              name: tDoc.name,
              description: tDoc.description,
              is_mandatory: tDoc.is_mandatory,
              attachment_path: tDoc.attachment_path || null,
              status: 'pending',
              created_by: auth.profile.id,
            })
        }
      }
    }

    const { data: firstPhase } = await supabaseAdmin
      .from('project_phases')
      .select('id, project_status_id')
      .eq('project_id', projectId)
      .order('order_index')
      .limit(1)
      .single()

    if (firstPhase) {
      await supabaseAdmin
        .from('project_phases')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', firstPhase.id)

      await supabaseAdmin
        .from('projects')
        .update({ 
          template_id: template_id,
          current_status_id: firstPhase.project_status_id
        })
        .eq('id', projectId)
    }

    return NextResponse.json({ 
      success: true, 
      message: `Template "${template.name}" importat cu succes`,
      phases_created: templatePhases.length
    })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/import-template error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}