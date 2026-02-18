/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/admin/templates/activities - Creează activitate nouă în fază
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot crea activități' }, { status: 403 })
    }

    const body = await req.json()
    const { template_phase_id, name, description, order_index, estimated_days } = body

    if (!template_phase_id || !name) {
      return NextResponse.json({ error: 'Faza și numele sunt obligatorii' }, { status: 400 })
    }

    // Calculează order_index dacă nu e furnizat
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
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ activity }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates/activities error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}