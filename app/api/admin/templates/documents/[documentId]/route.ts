/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/app/api/_utils/auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface RouteParams {
  params: Promise<{ documentId: string }>
}

// PATCH /api/admin/templates/documents/[documentId]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot modifica documente' }, { status: 403 })
    }

    const { documentId } = await params
    const body = await req.json()
    const { name, description, is_mandatory, order_index } = body

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (is_mandatory !== undefined) updateData.is_mandatory = is_mandatory
    if (order_index !== undefined) updateData.order_index = order_index

    const { data: doc, error } = await supabaseAdmin
      .from('template_document_requirements')
      .update(updateData)
      .eq('id', documentId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ document: doc })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/documents/[documentId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/documents/[documentId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin(req)
    if (!user) {
      return NextResponse.json({ error: 'Doar adminii pot șterge documente' }, { status: 403 })
    }

    const { documentId } = await params

    const { error } = await supabaseAdmin
      .from('template_document_requirements')
      .delete()
      .eq('id', documentId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/documents/[documentId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}