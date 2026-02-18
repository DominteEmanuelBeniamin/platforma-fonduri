/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/admin/statuses/reorder
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot reordona statusuri' }, { status: 403 })
    }

    const body = await req.json()
    const { orders } = body // Array de { id, order_index }

    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json({ error: 'Format invalid' }, { status: 400 })
    }

    // Update fiecare status cu noua ordine
    for (const item of orders) {
      const { error } = await supabaseAdmin
        .from('project_statuses')
        .update({ order_index: item.order_index })
        .eq('id', item.id)

      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('POST /api/admin/statuses/reorder error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}