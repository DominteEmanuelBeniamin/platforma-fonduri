import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '../../_utils/auth'
import { createSupabaseServiceClient } from '../../_utils/supabase'
import { getClientIP, getUserAgent } from '../../_utils/audit'

/**
 * DELETE /api/audit/[id]
 *
 * Sterge o intrare din audit_logs si scrie o intrare meta noua despre stergere
 * (action_type='delete', entity_type='audit_log') ca sa pastram trasabilitatea.
 * Doar adminii pot accesa acest endpoint.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing audit log id' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    const { data: existing, error: fetchError } = await admin
      .from('audit_logs')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Audit log not found' }, { status: 404 })
    }

    const { error: deleteError } = await admin
      .from('audit_logs')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('[audit_log_failure]', { op: 'delete', id, error: deleteError.message })
      return NextResponse.json({ error: 'Failed to delete audit log' }, { status: 500 })
    }

    const { error: metaError } = await admin.from('audit_logs').insert({
      user_id: ctx.user.id,
      action_type: 'delete',
      entity_type: 'audit_log',
      entity_id: id,
      entity_name: existing.description?.slice(0, 100) || `audit_log:${id}`,
      old_values: existing,
      new_values: null,
      description: `Stergere intrare audit ${existing.action_type} / ${existing.entity_type}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
    })

    if (metaError) {
      console.error('[audit_log_failure]', { op: 'meta-delete', id, error: metaError.message })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const error = e as Error
    console.error('DELETE /api/audit/[id] error:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}
