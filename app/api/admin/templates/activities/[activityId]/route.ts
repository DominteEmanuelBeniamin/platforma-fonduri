/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

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
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot modifica activități' }, { status: 403 })
    }

    const { activityId } = await params
    const body = await req.json()
    const { name, description, order_index, estimated_days, is_active } = body

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (order_index !== undefined) updateData.order_index = order_index
    if (estimated_days !== undefined) updateData.estimated_days = estimated_days
    if (is_active !== undefined) updateData.is_active = is_active

    const { data: activity, error } = await supabaseAdmin
      .from('template_activities')
      .update(updateData)
      .eq('id', activityId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ activity })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/activities/[activityId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/activities/[activityId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot șterge activități' }, { status: 403 })
    }

    const { activityId } = await params

    // Cascade delete va șterge și documentele
    const { error } = await supabaseAdmin
      .from('template_activities')
      .delete()
      .eq('id', activityId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/activities/[activityId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}