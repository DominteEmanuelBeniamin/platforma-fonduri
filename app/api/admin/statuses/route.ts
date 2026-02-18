/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/admin/statuses - Lista toate statusurile
export async function GET(req: NextRequest) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: statuses, error } = await supabaseAdmin
      .from('project_statuses')
      .select('*')
      .order('order_index', { ascending: true })

    if (error) throw error

    return NextResponse.json({ statuses })
  } catch (error: any) {
    console.error('GET /api/admin/statuses error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/admin/statuses - Creează status nou
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json()
    const { name, slug, description, color, icon, order_index } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Numele și slug-ul sunt obligatorii' }, { status: 400 })
    }

    // Verifică dacă slug-ul există deja
    const { data: existing } = await supabaseAdmin
      .from('project_statuses')
      .select('id')
      .eq('slug', slug)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Un status cu acest slug există deja' }, { status: 400 })
    }

    // Calculează order_index dacă nu e furnizat
    let finalOrderIndex = order_index
    if (!finalOrderIndex) {
      const { data: maxOrder } = await supabaseAdmin
        .from('project_statuses')
        .select('order_index')
        .order('order_index', { ascending: false })
        .limit(1)
        .single()
      
      finalOrderIndex = (maxOrder?.order_index || 0) + 1
    }

    const { data: status, error } = await supabaseAdmin
      .from('project_statuses')
      .insert({
        name,
        slug,
        description: description || null,
        color: color || '#6B7280',
        icon: icon || 'Circle',
        order_index: finalOrderIndex,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ status }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/statuses error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}