/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canReadTemplate, requireProfile } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { loadTemplateTrees } from '@/app/api/_utils/template-tree'
import { saveTemplateTree, TemplateSaveError } from '@/app/api/_utils/template-save'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/admin/templates
export async function GET(req: NextRequest) {
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!canReadTemplate(auth.profile.role)) {
      return NextResponse.json({ error: 'Forbidden: template access denied' }, { status: 403 })
    }

    // Arborele vine într-un număr constant de cereri. GET-ul nu mai verifică
    // atașamentele în storage și nu mai scrie nimic: starea „lipsă” se
    // actualizează la upload și la propagare.
    const templates = await loadTemplateTrees(supabaseAdmin, null, TEMPLATE_SELECT)

    return NextResponse.json({ templates })
  } catch (error: any) {
    console.error('GET /api/admin/templates error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

const TEMPLATE_SELECT = '*, measure:program_measures(name, program:programs(name))'

// POST /api/admin/templates
// Cu `phases` în corp, șablonul se creează împreună cu tot arborele, într-o
// singură cerere; dacă arborele nu se poate salva, șablonul gol nu rămâne.
export async function POST(req: NextRequest) {
  let createdTemplateId: string | null = null
  try {
    const auth = await requireProfile(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!canReadTemplate(auth.profile.role)) {
      return NextResponse.json({ error: 'Forbidden: template access denied' }, { status: 403 })
    }

    const body = await req.json()
    const { name, slug, description, measure_id, is_default } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Numele și slug-ul sunt obligatorii' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('project_templates')
      .select('id')
      .eq('slug', slug)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Un template cu acest slug există deja' }, { status: 400 })
    }

    const { data: template, error } = await supabaseAdmin
      .from('project_templates')
      .insert({
        name,
        slug,
        description: description || null,
        measure_id: measure_id || null,
        is_default: is_default || false,
        is_active: true,
        status: 'draft',
        created_by: auth.profile.id
      })
      .select()
      .single()

    if (error) throw error
    createdTemplateId = template.id

    const tree = Array.isArray(body.phases)
      ? await saveTemplateTree(supabaseAdmin, template.id, { name, description, phases: body.phases }, {
          actorId: auth.profile.id,
          request: req,
          templateSelect: TEMPLATE_SELECT,
        })
      : null

    await logAction({
      actorId: auth.profile.id,
      actionType: 'create',
      entityType: 'template',
      entityId: template.id,
      entityName: template.name,
      newValues: {
        name: template.name,
        slug: template.slug,
        description: template.description,
        measure_id: template.measure_id,
        is_default: template.is_default,
      },
      description: `Creare sablon ${template.name}`,
      request: req,
    })

    return NextResponse.json({ template: tree ?? template }, { status: 201 })
  } catch (error: any) {
    if (createdTemplateId) {
      await supabaseAdmin.from('project_templates').delete().eq('id', createdTemplateId)
    }
    if (error instanceof TemplateSaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('POST /api/admin/templates error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
