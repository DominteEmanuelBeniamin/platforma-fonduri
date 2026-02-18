/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

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
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { phaseId } = await params
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

    const { data: phase, error } = await supabaseAdmin
      .from('template_phases')
      .update(updateData)
      .eq('id', phaseId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ phase })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/phases/[phaseId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/phases/[phaseId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { phaseId } = await params

    const { error } = await supabaseAdmin
      .from('template_phases')
      .delete()
      .eq('id', phaseId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/phases/[phaseId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}