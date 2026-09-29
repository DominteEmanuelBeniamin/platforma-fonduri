/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTemplateAccess } from '@/app/api/_utils/auth'
import { saveTemplateTree, TemplateSaveError } from '@/app/api/_utils/template-save'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ templateId: string }>
}

// PUT /api/admin/templates/[templateId]/tree
// Salvează numele, descrierea și tot arborele (faze, activități, documente)
// dintr-o singură cerere și întoarce arborele salvat.
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { templateId } = await params
    const auth = await requireTemplateAccess(req, templateId, 'edit')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cerere invalidă' }, { status: 400 })
    }

    const template = await saveTemplateTree(supabaseAdmin, templateId, body, {
      actorId: auth.profile.id,
      request: req,
      templateSelect: '*, measure:program_measures(name, program:programs(name))',
    })
    return NextResponse.json({ template })
  } catch (error: any) {
    if (error instanceof TemplateSaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('PUT /api/admin/templates/[templateId]/tree error:', error)
    return NextResponse.json({ error: error?.message ?? 'Nu am putut salva șablonul.' }, { status: 500 })
  }
}
