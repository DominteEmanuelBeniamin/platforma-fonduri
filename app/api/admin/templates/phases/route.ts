/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireProfile, requireTemplateAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/admin/templates/phases - Creează fază nouă în template
export async function POST(req: NextRequest) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: 'Doar adminii pot crea faze' }, { status: 403 })
    }

    const body = await req.json()
    const { template_id, project_status_id, name, slug, description, order_index, estimated_days } = body

    if (!template_id || !project_status_id || !name) {
      return NextResponse.json({ error: 'Template, status și nume sunt obligatorii' }, { status: 400 })
    }

    // Generează slug dacă nu e furnizat
    const templateAccess = await requireTemplateAccess(req, template_id, 'edit')
    if (!templateAccess.ok) {
      return NextResponse.json({ error: templateAccess.error }, { status: templateAccess.status })
    }

    const finalSlug = slug || name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    // Verifică slug unic în template
    const { data: existing } = await supabaseAdmin
      .from('template_phases')
      .select('id')
      .eq('template_id', template_id)
      .eq('slug', finalSlug)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'O fază cu acest slug există deja în template' }, { status: 400 })
    }

    // Calculează order_index dacă nu e furnizat
    let finalOrderIndex = order_index
    if (!finalOrderIndex) {
      const { data: maxOrder } = await supabaseAdmin
        .from('template_phases')
        .select('order_index')
        .eq('template_id', template_id)
        .order('order_index', { ascending: false })
        .limit(1)
        .single()
      
      finalOrderIndex = (maxOrder?.order_index || 0) + 1
    }

    const { data: phase, error } = await supabaseAdmin
      .from('template_phases')
      .insert({
        template_id,
        project_status_id,
        name,
        slug: finalSlug,
        description: description || null,
        order_index: finalOrderIndex,
        estimated_days: estimated_days || null,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    const { data: templateRow } = await supabaseAdmin
      .from('project_templates')
      .select('name')
      .eq('id', template_id)
      .maybeSingle()
    const templateName = templateRow?.name ?? template_id

    await logAction({
      actorId: auth.profile.id,
      actionType: 'add',
      entityType: 'template_phase',
      entityId: phase.id,
      entityName: phase.name,
      newValues: { ...phase, template_name: templateName },
      description: `Adaugare faza "${phase.name}" in sablonul "${templateName}"`,
      request: req,
    })

    return NextResponse.json({ phase }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/admin/templates/phases error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
