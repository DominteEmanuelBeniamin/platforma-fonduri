/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'
import { computeDiff, logAction } from '@/app/api/_utils/audit'

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
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { activityId } = await params
    const body = await req.json()
    const { name, description, order_index, estimated_days, is_active, default_consultant_id } = body

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (order_index !== undefined) updateData.order_index = order_index
    if (estimated_days !== undefined) updateData.estimated_days = estimated_days
    if (is_active !== undefined) updateData.is_active = is_active
    if (default_consultant_id !== undefined) updateData.default_consultant_id = default_consultant_id || null

    const { data: before } = await supabaseAdmin
      .from('template_activities')
      .select('*')
      .eq('id', activityId)
      .maybeSingle()

    const { data: activity, error } = await supabaseAdmin
      .from('template_activities')
      .update(updateData)
      .eq('id', activityId)
      .select()
      .single()

    if (error) throw error

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

    return NextResponse.json({ activity })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/activities/[activityId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/activities/[activityId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { activityId } = await params

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

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/activities/[activityId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
