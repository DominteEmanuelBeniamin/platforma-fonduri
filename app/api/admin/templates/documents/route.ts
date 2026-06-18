/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { normalizeRequirementType, requirementTypeToMandatory } from '@/lib/requirement-type'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/admin/templates/documents - Creează document requirement în activitate
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: 'Doar adminii pot crea cerințe de documente' }, { status: 403 })
    }

    const body = await req.json()
    const {
      template_activity_id,
      name,
      description,
      is_mandatory,
      order_index,
      attachment_path,
      attachment_original_name,
    } = body
    const requirement_type = normalizeRequirementType(body?.requirement_type, is_mandatory)

    if (!template_activity_id || !name) {
      return NextResponse.json({ error: 'Activitatea și numele sunt obligatorii' }, { status: 400 })
    }

    // Calculează order_index dacă nu e furnizat
    let finalOrderIndex = order_index
    if (finalOrderIndex === undefined) {
      const { data: maxOrder } = await supabaseAdmin
        .from('template_document_requirements')
        .select('order_index')
        .eq('template_activity_id', template_activity_id)
        .order('order_index', { ascending: false })
        .limit(1)
        .single()
      
      finalOrderIndex = (maxOrder?.order_index || 0) + 1
    }

    const { data: doc, error } = await supabaseAdmin
      .from('template_document_requirements')
      .insert({
        template_activity_id,
        name,
        description: description || null,
        requirement_type,
        is_mandatory: requirementTypeToMandatory(requirement_type),
        order_index: finalOrderIndex,
        attachment_path: attachment_path || null,
        attachment_original_name: attachment_path ? attachment_original_name || null : null,
        is_active: true,
      })
      .select()
      .single()

    if (error) throw error

    const { data: actRow } = await supabaseAdmin
      .from('template_activities')
      .select('name, template_phases(name, project_templates(name))')
      .eq('id', template_activity_id)
      .maybeSingle()
    const activityName = actRow?.name ?? template_activity_id
    const phaseName = (actRow as any)?.template_phases?.name ?? ''
    const templateName = (actRow as any)?.template_phases?.project_templates?.name ?? ''

    await logAction({
      actorId: auth.profile.id,
      actionType: 'add',
      entityType: 'template_document',
      entityId: doc.id,
      entityName: doc.name,
      newValues: { ...doc, template_name: templateName, phase_name: phaseName, activity_name: activityName },
      description: `Adaugare cerinta document "${doc.name}" in activitatea "${activityName}" (faza "${phaseName}", sablonul "${templateName}")`,
      request: req,
    })

    return NextResponse.json({ document: doc }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates/documents error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
