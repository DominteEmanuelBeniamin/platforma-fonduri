/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireTemplateAccess } from '@/app/api/_utils/auth'
import { computeDiff, logAction } from '@/app/api/_utils/audit'

async function loadTemplateName(templateId: string | null | undefined): Promise<string> {
  if (!templateId) return ''
  const { data } = await supabaseAdmin
    .from('project_templates')
    .select('name')
    .eq('id', templateId)
    .maybeSingle()
  return data?.name ?? templateId
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ phaseId: string }>
}

// PATCH /api/admin/templates/phases/[phaseId]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { phaseId } = await params
    const { data: phaseAccessRow, error: phaseAccessError } = await supabaseAdmin
      .from('template_phases')
      .select('template_id')
      .eq('id', phaseId)
      .maybeSingle()
    if (phaseAccessError) throw phaseAccessError
    if (!phaseAccessRow) return NextResponse.json({ error: 'Faza nu a fost găsită' }, { status: 404 })
    const templateAccess = await requireTemplateAccess(req, phaseAccessRow.template_id, 'edit')
    if (!templateAccess.ok) return NextResponse.json({ error: templateAccess.error }, { status: templateAccess.status })

    const body = await req.json()
    const { name, slug, description, project_status_id, order_index, estimated_days, is_active } = body

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (project_status_id !== undefined) updateData.project_status_id = project_status_id
    if (order_index !== undefined) updateData.order_index = order_index
    if (estimated_days !== undefined) updateData.estimated_days = estimated_days
    if (is_active !== undefined) updateData.is_active = is_active

    // Dacă se schimbă name și nu e furnizat slug explicit, regenerează slug-ul
    if (slug !== undefined) {
      updateData.slug = slug
    } else if (name !== undefined) {
      updateData.slug = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    }

    // Verifică unicitate slug dacă se schimbă (excludând faza curentă)
    if (updateData.slug) {
      const { data: phaseRow } = await supabaseAdmin
        .from('template_phases')
        .select('template_id')
        .eq('id', phaseId)
        .single()

      if (phaseRow) {
        const { data: existing } = await supabaseAdmin
          .from('template_phases')
          .select('id')
          .eq('template_id', phaseRow.template_id)
          .eq('slug', updateData.slug)
          .neq('id', phaseId)
          .maybeSingle()

        if (existing) {
          // Adaugă suffix unic în loc să returneze eroare
          updateData.slug = `${updateData.slug}-${Date.now()}`
        }
      }
    }

    const { data: before } = await supabaseAdmin
      .from('template_phases')
      .select('*')
      .eq('id', phaseId)
      .maybeSingle()

    const { data: phase, error } = await supabaseAdmin
      .from('template_phases')
      .update(updateData)
      .eq('id', phaseId)
      .select()
      .single()

    if (error) throw error

    const diff = computeDiff(before, updateData)
    if (!diff.isEmpty) {
      const templateName = await loadTemplateName(phase.template_id)
      await logAction({
        actorId: auth.profile.id,
        actionType: 'update',
        entityType: 'template_phase',
        entityId: phaseId,
        entityName: phase.name,
        oldValues: { ...diff.oldValues, template_name: templateName },
        newValues: { ...diff.newValues, template_name: templateName },
        description: `Modificare faza "${phase.name}" in sablonul "${templateName}" (${diff.changedKeys.join(', ')})`,
        request: req,
      })
    }

    return NextResponse.json({ phase })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/phases/[phaseId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/phases/[phaseId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { phaseId } = await params
    const { data: phaseAccessRow, error: phaseAccessError } = await supabaseAdmin
      .from('template_phases')
      .select('template_id')
      .eq('id', phaseId)
      .maybeSingle()
    if (phaseAccessError) throw phaseAccessError
    if (!phaseAccessRow) return NextResponse.json({ error: 'Faza nu a fost găsită' }, { status: 404 })
    const templateAccess = await requireTemplateAccess(req, phaseAccessRow.template_id, 'edit')
    if (!templateAccess.ok) return NextResponse.json({ error: templateAccess.error }, { status: templateAccess.status })

    const { data: before } = await supabaseAdmin
      .from('template_phases')
      .select('*')
      .eq('id', phaseId)
      .maybeSingle()

    const { error } = await supabaseAdmin
      .from('template_phases')
      .update({ is_active: false })
      .eq('id', phaseId)

    if (error) throw error

    const templateName = await loadTemplateName(before?.template_id)
    await logAction({
      actorId: auth.profile.id,
      actionType: 'delete',
      entityType: 'template_phase',
      entityId: phaseId,
      entityName: before?.name ?? phaseId,
      oldValues: before ? { ...before, template_name: templateName } : null,
      description: `Eliminare faza "${before?.name ?? phaseId}" din sablonul "${templateName}"`,
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/phases/[phaseId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
