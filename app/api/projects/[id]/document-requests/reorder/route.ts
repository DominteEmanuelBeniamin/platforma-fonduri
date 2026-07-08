/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

// POST /api/projects/[id]/document-requests/reorder - Reordonare în bloc a cererilor de documente
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    if (access.profile.role !== 'admin' && access.profile.role !== 'consultant') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const orders = body?.orders // Array de { id, order_index }

    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json({ error: 'Format invalid' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    // Update fiecare cerere cu noua ordine, scopat pe proiect (id-uri străine = no-op)
    for (const item of orders) {
      const { error } = await admin
        .from('document_requirements')
        .update({ order_index: item.order_index })
        .eq('id', item.id)
        .eq('project_id', projectId)

      if (error) throw error
    }

    const { data: projectRow } = await admin
      .from('projects')
      .select('title')
      .eq('id', projectId)
      .maybeSingle()
    const projectTitle = projectRow?.title ?? projectId

    await logAction({
      actorId: access.user.id,
      actionType: 'update',
      entityType: 'document_request_reorder',
      entityId: null,
      entityName: 'Reordonare cereri documente',
      newValues: { order: orders, project_id: projectId },
      description: `Reordonare a ${orders.length} cereri de documente în proiectul "${projectTitle}"`,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/document-requests/reorder error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
