/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireTemplateAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { normalizeRequirementType, requirementTypeToMandatory } from '@/lib/requirement-type'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/admin/templates/documents - Creează document requirement în activitate
export async function POST(req: NextRequest) {
  try {
    const auth = await requireProfile(req)
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
      attachments,
    } = body
    const is_outgoing = body?.is_outgoing === true
    const attachmentItems = Array.isArray(attachments)
      ? attachments.filter((item: any) => item && typeof item.storage_path === 'string' && item.storage_path.trim())
      : null
    const attachmentPath = attachmentItems?.[0]?.storage_path || attachment_path || null
    const requirement_type = is_outgoing ? 'optional' : normalizeRequirementType(body?.requirement_type, is_mandatory)

    if (!template_activity_id || !name) {
      return NextResponse.json({ error: 'Activitatea și numele sunt obligatorii' }, { status: 400 })
    }

    const { data: activityRow, error: activityError } = await supabaseAdmin
      .from('template_activities')
      .select('template_phases(template_id)')
      .eq('id', template_activity_id)
      .maybeSingle()
    if (activityError) throw activityError
    const templateId = (activityRow as any)?.template_phases?.template_id
    if (!templateId) return NextResponse.json({ error: 'Activitatea nu a fost găsită' }, { status: 404 })

    const templateAccess = await requireTemplateAccess(req, templateId, 'edit')
    if (!templateAccess.ok) {
      return NextResponse.json({ error: templateAccess.error }, { status: templateAccess.status })
    }

    if (is_outgoing && !attachmentPath) {
      return NextResponse.json({ error: 'Trebuie atașat un fișier pentru documentul trimis clientului.' }, { status: 400 })
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
        attachment_path: attachmentPath,
        attachment_original_name: attachmentPath ? attachmentItems?.[0]?.original_name || attachment_original_name || null : null,
        is_outgoing,
        is_active: true,
      })
      .select()
      .single()

    if (error) throw error

    if (doc && attachmentItems) {
      const { error: attachmentsError } = await supabaseAdmin
        .from('document_requirement_attachments')
        .insert(attachmentItems.map((attachment: any, index: number) => ({
          template_document_requirement_id: doc.id,
          storage_path: attachment.storage_path.trim(),
          original_name: typeof attachment.original_name === 'string' ? attachment.original_name : null,
          mime_type: typeof attachment.mime_type === 'string' ? attachment.mime_type : null,
          file_size: typeof attachment.file_size === 'number' ? attachment.file_size : null,
          order_index: index,
          created_by: auth.profile.id,
        })))
      if (attachmentsError) throw attachmentsError
    }

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
