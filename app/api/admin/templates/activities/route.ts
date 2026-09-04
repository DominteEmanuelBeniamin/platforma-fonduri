/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireTemplateAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { parseTemplateDuplication } from '@/app/api/_utils/template-duplication'
import type { TemplateDuplication } from '@/app/api/_utils/template-duplication'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/admin/templates/activities - Creează activitate nouă în fază
export async function POST(req: NextRequest) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: 'Doar adminii pot crea activități' }, { status: 403 })
    }

    const body = await req.json()
    const { template_phase_id, name, description, order_index, estimated_days, default_consultant_id } = body

    if (!template_phase_id || !name) {
      return NextResponse.json({ error: 'Faza și numele sunt obligatorii' }, { status: 400 })
    }

    // Calculează order_index dacă nu e furnizat
    const { data: phaseAccessRow, error: phaseError } = await supabaseAdmin
      .from('template_phases')
      .select('template_id')
      .eq('id', template_phase_id)
      .maybeSingle()
    if (phaseError) throw phaseError
    if (!phaseAccessRow) return NextResponse.json({ error: 'Faza nu a fost găsită' }, { status: 404 })

    const templateAccess = await requireTemplateAccess(req, phaseAccessRow.template_id, 'edit')
    if (!templateAccess.ok) {
      return NextResponse.json({ error: templateAccess.error }, { status: templateAccess.status })
    }

    let duplication: TemplateDuplication | undefined
    if (body.duplication !== undefined) {
      const parsed = parseTemplateDuplication(body.duplication, 'template_activity')
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      duplication = parsed.value
      if (duplication.source_kind === 'persistent') {
        const { data: source, error: sourceError } = await supabaseAdmin
          .from('template_activities')
          .select('id, name, template_phases(template_id)')
          .eq('id', duplication.source_id)
          .maybeSingle()
        if (sourceError) throw sourceError
        const sourceTemplateId = (source as any)?.template_phases?.template_id
        if (!source || sourceTemplateId !== phaseAccessRow.template_id) {
          return NextResponse.json({ error: 'Sursa duplicării nu aparține acestui template.' }, { status: 400 })
        }
        duplication = { ...duplication, source_name: source.name }
      }
    }

    let finalOrderIndex = order_index
    if (!finalOrderIndex) {
      const { data: maxOrder } = await supabaseAdmin
        .from('template_activities')
        .select('order_index')
        .eq('template_phase_id', template_phase_id)
        .order('order_index', { ascending: false })
        .limit(1)
        .single()

      finalOrderIndex = (maxOrder?.order_index || 0) + 1
    }

    const { data: activity, error } = await supabaseAdmin
      .from('template_activities')
      .insert({
        template_phase_id,
        name,
        description: description || null,
        order_index: finalOrderIndex,
        estimated_days: estimated_days || null,
        default_consultant_id: default_consultant_id || null,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    const { data: phaseRow } = await supabaseAdmin
      .from('template_phases')
      .select('name, template_id, project_templates(name)')
      .eq('id', template_phase_id)
      .maybeSingle()
    const phaseName = phaseRow?.name ?? template_phase_id
    const templateName = (phaseRow as any)?.project_templates?.name ?? phaseRow?.template_id ?? ''

    await logAction({
      actorId: auth.profile.id,
      actionType: duplication ? 'create' : 'add',
      entityType: 'template_activity',
      entityId: activity.id,
      entityName: activity.name,
      newValues: {
        ...activity,
        template_name: templateName,
        phase_name: phaseName,
        ...(duplication ? { duplication } : {}),
      },
      description: duplication
        ? `Duplicare activitate "${activity.name}" in faza "${phaseName}" (sablonul "${templateName}")`
        : `Adaugare activitate "${activity.name}" in faza "${phaseName}" (sablonul "${templateName}")`,
      request: req,
    })

    return NextResponse.json({ activity }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates/activities error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
