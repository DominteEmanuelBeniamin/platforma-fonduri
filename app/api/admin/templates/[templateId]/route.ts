/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'
import { computeDiff, logAction } from '@/app/api/_utils/audit'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ templateId: string }>
}

// GET /api/admin/templates/[templateId]
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { templateId } = await params

    const { data: template, error } = await supabaseAdmin
      .from('project_templates')
      .select('*')
      .eq('id', templateId)
      .single()

    if (error || !template) {
      return NextResponse.json({ error: 'Template negăsit' }, { status: 404 })
    }

    return NextResponse.json({ template })
  } catch (error: any) {
    console.error('GET /api/admin/templates/[templateId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/admin/templates/[templateId]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: 'Doar adminii pot modifica template-uri' }, { status: 403 })
    }

    const { templateId } = await params
    const body = await req.json()
    const { name, slug, description, measure_id, is_default, is_active } = body

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (slug !== undefined) updateData.slug = slug
    if (description !== undefined) updateData.description = description
    if (measure_id !== undefined) updateData.measure_id = measure_id
    if (is_default !== undefined) updateData.is_default = is_default
    if (is_active !== undefined) updateData.is_active = is_active

    const { data: before } = await supabaseAdmin
      .from('project_templates')
      .select('*')
      .eq('id', templateId)
      .maybeSingle()

    const { data: template, error } = await supabaseAdmin
      .from('project_templates')
      .update(updateData)
      .eq('id', templateId)
      .select()
      .single()

    if (error) throw error

    const diff = computeDiff(before, updateData)
    if (!diff.isEmpty) {
      await logAction({
        actorId: auth.profile.id,
        actionType: 'update',
        entityType: 'template',
        entityId: templateId,
        entityName: template.name,
        oldValues: diff.oldValues,
        newValues: diff.newValues,
        description: `Modificare sablon "${template.name}" (${diff.changedKeys.join(', ')})`,
        request: req,
      })
    }

    return NextResponse.json({ template })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/[templateId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/[templateId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: 'Doar adminii pot șterge template-uri' }, { status: 403 })
    }

    const { templateId } = await params

    const { data: before } = await supabaseAdmin
      .from('project_templates')
      .select('*')
      .eq('id', templateId)
      .maybeSingle()

    if (!before) {
      return NextResponse.json({ error: 'Template negăsit' }, { status: 404 })
    }

    const { data: linkedProjects, count: linkedProjectsCount, error: linkedProjectsError } = await supabaseAdmin
      .from('projects')
      .select('id, title', { count: 'exact' })
      .eq('template_id', templateId)
      .range(0, 4)

    if (linkedProjectsError) throw linkedProjectsError

    if ((linkedProjectsCount ?? 0) > 0) {
      const projectNames = (linkedProjects ?? [])
        .map(project => `"${project.title || project.id}"`)
        .join(', ')
      const suffix = (linkedProjectsCount ?? 0) > (linkedProjects?.length ?? 0)
        ? ` și încă ${(linkedProjectsCount ?? 0) - (linkedProjects?.length ?? 0)}`
        : ''

      return NextResponse.json(
        {
          error: `Template-ul "${before.name}" nu poate fi șters deoarece este folosit de ${linkedProjectsCount} proiect(e): ${projectNames}${suffix}. Elimină sau schimbă template-ul de pe proiectele respective înainte de ștergere.`,
          code: 'template_in_use',
          project_count: linkedProjectsCount,
          projects: linkedProjects ?? [],
        },
        { status: 409 }
      )
    }

    // Ștergerea va fi cascade datorită ON DELETE CASCADE
    const { error } = await supabaseAdmin
      .from('project_templates')
      .delete()
      .eq('id', templateId)

    if (error) throw error

    await logAction({
      actorId: auth.profile.id,
      actionType: 'delete',
      entityType: 'template',
      entityId: templateId,
      entityName: before?.name ?? templateId,
      oldValues: before ?? null,
      description: `Stergere sablon ${before?.name ?? templateId}`,
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/[templateId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
