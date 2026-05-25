/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardToResponse, requireAdmin } from '@/app/api/_utils/auth'

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
    const auth = await requireAdmin(req)
    if (!auth.ok) return guardToResponse(auth)

    const { documentId } = await params
    const body = await req.json()
    const { name, description, is_mandatory, order_index, attachment_path, attachment_original_name } = body

    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (is_mandatory !== undefined) updateData.is_mandatory = is_mandatory
    if (order_index !== undefined) updateData.order_index = order_index
    if (attachment_path !== undefined) {
      updateData.attachment_path = attachment_path || null
      updateData.attachment_original_name = attachment_path ? attachment_original_name || null : null
      updateData.attachment_missing_at = null
      updateData.attachment_missing_checked_at = null
    }

    const { data: previousDoc, error: previousError } = await supabaseAdmin
      .from('template_document_requirements')
      .select('id, name, attachment_path, attachment_missing_at')
      .eq('id', documentId)
      .maybeSingle()

    if (previousError) throw previousError

    const { data: doc, error } = await supabaseAdmin
      .from('template_document_requirements')
      .update(updateData)
      .eq('id', documentId)
      .select()
      .single()

    if (error) throw error

    if (attachment_path !== undefined && previousDoc?.attachment_path !== doc.attachment_path) {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: auth.user.id,
        action_type: 'update',
        entity_type: 'template_document_requirement',
        entity_id: documentId,
        entity_name: doc.name || previousDoc?.name || 'Document template',
        old_values: {
          attachment_path: previousDoc?.attachment_path ?? null,
          attachment_missing_at: previousDoc?.attachment_missing_at ?? null,
        },
        new_values: {
          attachment_path: doc.attachment_path ?? null,
          attachment_missing_at: doc.attachment_missing_at ?? null,
        },
        description: doc.attachment_path
          ? `${auth.profile.email || 'Admin'} a înlocuit modelul documentului "${doc.name || documentId}"`
          : `${auth.profile.email || 'Admin'} a eliminat modelul documentului "${doc.name || documentId}"`,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
      })
    }

    return NextResponse.json({ document: doc })
  } catch (error: any) {
    console.error('PATCH /api/admin/templates/documents/[documentId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/admin/templates/documents/[documentId]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return guardToResponse(auth)

    const { documentId } = await params

    const { error } = await supabaseAdmin
      .from('template_document_requirements')
      .update({ is_active: false })
      .eq('id', documentId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/admin/templates/documents/[documentId] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
