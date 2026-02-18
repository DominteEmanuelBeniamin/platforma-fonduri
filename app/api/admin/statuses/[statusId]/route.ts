/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: { statusId: string }
}

// GET /api/admin/statuses/[statusId]
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { statusId } = params

    const { data: status, error } = await supabaseAdmin
      .from('project_statuses')
      .select('*')
      .eq('id', statusId)
      .single()

    if (error || !status) {
      return NextResponse.json({ error: 'Status negăsit' }, { status: 404 })
    }

    return NextResponse.json({ status })
  } catch (error: any) {
    console.error('GET /api/admin/statuses/[statusId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/admin/statuses/[statusId] - Actualizare status
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot modifica statusuri' }, { status: 403 })
    }

    const { statusId } = params
    const body = await req.json()
    const { name, slug, description, color, icon, order_index, is_active } = body

    // Verifică dacă statusul există
    const { data: existing } = await supabaseAdmin
      .from('project_statuses')
      .select('id')
      .eq('id', statusId)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Status negăsit' }, { status: 404 })
    }

    // Verifică slug unic dacă se schimbă
    if (slug) {
      const { data: slugExists } = await supabaseAdmin
        .from('project_statuses')
        .select('id')
        .eq('slug', slug)
        .neq('id', statusId)
        .single()

      if (slugExists) {
        return NextResponse.json({ error: 'Un status cu acest slug există deja' }, { status: 400 })
      }
    }

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (slug !== undefined) updateData.slug = slug
    if (description !== undefined) updateData.description = description
    if (color !== undefined) updateData.color = color
    if (icon !== undefined) updateData.icon = icon
    if (order_index !== undefined) updateData.order_index = order_index
    if (is_active !== undefined) updateData.is_active = is_active

    const { data: status, error } = await supabaseAdmin
      .from('project_statuses')
      .update(updateData)
      .eq('id', statusId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ status })
  } catch (error: any) {
    console.error('PATCH /api/admin/statuses/[statusId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/statuses/[statusId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot șterge statusuri' }, { status: 403 })
    }

    const { statusId } = params

    // Verifică dacă există faze care folosesc acest status
    const { data: phases } = await supabaseAdmin
      .from('project_phases')
      .select('id')
      .eq('project_status_id', statusId)
      .limit(1)

    if (phases && phases.length > 0) {
      return NextResponse.json({ 
        error: 'Nu poți șterge un status folosit de faze existente. Dezactivează-l în schimb.' 
      }, { status: 400 })
    }

    // Verifică și template phases
    const { data: templatePhases } = await supabaseAdmin
      .from('template_phases')
      .select('id')
      .eq('project_status_id', statusId)
      .limit(1)

    if (templatePhases && templatePhases.length > 0) {
      return NextResponse.json({ 
        error: 'Nu poți șterge un status folosit în template-uri. Dezactivează-l în schimb.' 
      }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('project_statuses')
      .delete()
      .eq('id', statusId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/statuses/[statusId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}