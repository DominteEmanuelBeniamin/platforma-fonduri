/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireTemplateAccess } from '@/app/api/_utils/auth'
import { computeDiff, logAction } from '@/app/api/_utils/audit'
import { markTemplateChanged } from '@/app/api/_utils/template-changes'
import { inactiveReferenceConflict } from '@/app/api/_utils/inactive-reference'

async function loadActivityChain(templatePhaseId: string | null | undefined) {
  if (!templatePhaseId) return { phaseName: '', templateName: '' }
  const { data } = await supabaseAdmin
    .from('template_phases')
    .select('name, project_templates(name)')
    .eq('id', templatePhaseId)
    .maybeSingle()
  return {
    phaseName: data?.name ?? templatePhaseId,
    templateName: (data as any)?.project_templates?.name ?? '',
  }
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ activityId: string }>
}

// PATCH /api/admin/templates/activities/[activityId]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { activityId } = await params
    const { data: activityAccessRow, error: activityAccessError } = await supabaseAdmin
      .from('template_activities')
      .select('template_phases(template_id)')
      .eq('id', activityId)
      .maybeSingle()
    if (activityAccessError) throw activityAccessError
    const templateId = (activityAccessRow as any)?.template_phases?.template_id
    if (!templateId) return NextResponse.json({ error: 'Activitatea nu a fost găsită' }, { status: 404 })
    const templateAccess = await requireTemplateAccess(req, templateId, 'edit')
    if (!templateAccess.ok) return NextResponse.json({ error: templateAccess.error }, { status: templateAccess.status })

    const body = await req.json()
    const { name, description, order_index, estimated_days, is_active, default_consultant_id } = body

    if (default_consultant_id !== undefined && default_consultant_id !== null && typeof default_consultant_id !== 'string') {
      return NextResponse.json({ error: 'default_consultant_id trebuie să fie UUID sau null' }, { status: 400 })
    }
    const defaultConsultantId = default_consultant_id === undefined
      ? undefined
      : typeof default_consultant_id === 'string'
      ? default_consultant_id.trim() || null
      : null

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (order_index !== undefined) updateData.order_index = order_index
    if (estimated_days !== undefined) updateData.estimated_days = estimated_days
    if (is_active !== undefined) updateData.is_active = is_active
    if (defaultConsultantId !== undefined) updateData.default_consultant_id = defaultConsultantId

    const { data: before } = await supabaseAdmin
      .from('template_activities')
      .select('*')
      .eq('id', activityId)
      .maybeSingle()

    if (
      defaultConsultantId &&
      defaultConsultantId !== before?.default_consultant_id
    ) {
      const { data: consultant, error: consultantError } = await supabaseAdmin
        .from('profiles')
        .select('role, is_active')
        .eq('id', defaultConsultantId)
        .maybeSingle()
      if (consultantError) throw consultantError
      if (!consultant || consultant.role !== 'consultant') {
        return NextResponse.json({ error: 'Implicita de atribuire trebuie să fie un consultant valid.' }, { status: 400 })
      }
      if (consultant.is_active === false) {
        return NextResponse.json({ error: 'Implicita de atribuire trebuie să fie un consultant activ.' }, { status: 409 })
      }
    }

    const { data: activity, error } = await supabaseAdmin
      .from('template_activities')
      .update(updateData)
      .eq('id', activityId)
      .select()
      .single()

    if (error) {
      const inactive = inactiveReferenceConflict(error, 'Nu poți seta un consultant implicit dezactivat.')
      if (inactive) return NextResponse.json(inactive.body, { status: inactive.status })
      throw error
    }

    const diff = computeDiff(before, updateData)
    if (!diff.isEmpty) {
      const { phaseName, templateName } = await loadActivityChain(activity.template_phase_id)
      await logAction({
        actorId: auth.profile.id,
        actionType: 'update',
        entityType: 'template_activity',
        entityId: activityId,
        entityName: activity.name,
        oldValues: { ...diff.oldValues, template_name: templateName, phase_name: phaseName },
        newValues: { ...diff.newValues, template_name: templateName, phase_name: phaseName },
        description: `Modificare activitate "${activity.name}" in faza "${phaseName}" (sablonul "${templateName}") (${diff.changedKeys.join(', ')})`,
        request: req,
      })
    }

    await markTemplateChanged(templateAccess.template)
    return NextResponse.json({ activity })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/activities/[activityId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/activities/[activityId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { activityId } = await params
    const { data: activityAccessRow, error: activityAccessError } = await supabaseAdmin
      .from('template_activities')
      .select('template_phases(template_id)')
      .eq('id', activityId)
      .maybeSingle()
    if (activityAccessError) throw activityAccessError
    const templateId = (activityAccessRow as any)?.template_phases?.template_id
    if (!templateId) return NextResponse.json({ error: 'Activitatea nu a fost găsită' }, { status: 404 })
    const templateAccess = await requireTemplateAccess(req, templateId, 'edit')
    if (!templateAccess.ok) return NextResponse.json({ error: templateAccess.error }, { status: templateAccess.status })

    const { data: before } = await supabaseAdmin
      .from('template_activities')
      .select('*')
      .eq('id', activityId)
      .maybeSingle()

    const { error } = await supabaseAdmin
      .from('template_activities')
      .update({ is_active: false })
      .eq('id', activityId)

    if (error) throw error

    const { phaseName, templateName } = await loadActivityChain(before?.template_phase_id)
    await logAction({
      actorId: auth.profile.id,
      actionType: 'delete',
      entityType: 'template_activity',
      entityId: activityId,
      entityName: before?.name ?? activityId,
      oldValues: before ? { ...before, template_name: templateName, phase_name: phaseName } : null,
      description: `Eliminare activitate "${before?.name ?? activityId}" din faza "${phaseName}" (sablonul "${templateName}")`,
      request: req,
    })

    await markTemplateChanged(templateAccess.template)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/activities/[activityId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
