/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/admin/templates/documents - Creează document requirement în activitate
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot crea cerințe de documente' }, { status: 403 })
    }

    const body = await req.json()
    const { template_activity_id, name, description, is_mandatory, order_index, attachment_path } = body

    if (!template_activity_id || !name) {
      return NextResponse.json({ error: 'Activitatea și numele sunt obligatorii' }, { status: 400 })
    }

    // Calculează order_index dacă nu e furnizat
    let finalOrderIndex = order_index
    if (finalOrderIndex === undefined) {
      const { data: maxOrder } = await supabaseAdmin
        .from('template_document_requirements')
        .select('order_index')
        .eq('template_activity_id', template_activity_id)
        .order('order_index', { ascending: false })
        .limit(1)
        .single()
      
      finalOrderIndex = (maxOrder?.order_index || 0) + 1
    }

    const { data: doc, error } = await supabaseAdmin
      .from('template_document_requirements')
      .insert({
        template_activity_id,
        name,
        description: description || null,
        is_mandatory: is_mandatory || false,
        order_index: finalOrderIndex,
        attachment_path: attachment_path || null,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ document: doc }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates/documents error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}