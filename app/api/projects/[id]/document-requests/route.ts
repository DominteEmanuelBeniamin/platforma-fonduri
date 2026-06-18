/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { normalizeRequirementType, requirementTypeToMandatory } from '@/lib/requirement-type'

type LatestRejection = {
  reason: string
  reviewed_at: string
  reviewed_by: { id: string; full_name: string | null } | null
  reviewed_version_number: number
} | null

async function loadLatestRejections(admin: ReturnType<typeof createSupabaseServiceClient>, requestIds: string[]) {
  const latest = new Map<string, LatestRejection>()
  if (requestIds.length === 0) return latest

  const { data, error } = await admin
    .from('document_request_reviews')
    .select('requirement_id, reason, reviewed_at, reviewed_version_number, reviewer:reviewed_by(id, full_name)')
    .in('requirement_id', requestIds)
    .eq('action', 'rejected')
    .order('reviewed_at', { ascending: false })

  if (error) {
    console.error('latest rejection lookup error:', error)
    return latest
  }

  for (const row of data ?? []) {
    if (latest.has((row as any).requirement_id)) continue
    const reviewerRelation = (row as any).reviewer
    const reviewer = Array.isArray(reviewerRelation) ? reviewerRelation[0] : reviewerRelation
    latest.set((row as any).requirement_id, {
      reason: (row as any).reason || '',
      reviewed_at: (row as any).reviewed_at,
      reviewed_by: reviewer ? { id: reviewer.id, full_name: reviewer.full_name ?? null } : null,
      reviewed_version_number: (row as any).reviewed_version_number,
    })
  }

  return latest
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    const admin = createSupabaseServiceClient()

    const { data, error } = await admin
      .from('document_requirements')
      .select(`
        id,
        project_id,
        activity_id,
        name,
        description,
        status,
        is_mandatory,
        requirement_type,
        attachment_path,
        attachment_original_name,
        attachment_missing_at,
        attachment_missing_checked_at,
        deadline_at,
        created_by,
        created_at,
        deleted_at,
        deleted_by,
        creator:created_by(full_name, email),
        assigned_to,
        assigned_consultant:assigned_to(id, full_name, email),
        activity:activity_id(id, name, phase_id),
        files(
          id,
          storage_path,
          original_name,
          mime_type,
          file_size,
          version_number,
          comments,
          created_at,
          uploaded_by,
          deleted_at,
          deleted_by
        )
      `)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('GET document-requests error:', error)
      return NextResponse.json({ error: 'Failed to load document requests' }, { status: 500 })
    }

    const rows = data ?? []
    const latestRejections = await loadLatestRejections(admin, rows.map((row: any) => row.id))
    const requests = rows.map((row: any) => ({
      ...row,
      latest_rejection: latestRejections.get(row.id) ?? null,
      files: (row.files ?? []).filter((file: any) => !file.deleted_at),
    }))

    return NextResponse.json({ requests })
  } catch (e: any) {
    console.error('GET document-requests exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}

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
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const description = typeof body?.description === 'string' ? body.description.trim() : null
    const deadline_at = typeof body?.deadline_at === 'string' && body.deadline_at ? body.deadline_at : null
    const attachment_path = typeof body?.attachment_path === 'string' && body.attachment_path ? body.attachment_path : null
    const attachment_original_name =
      typeof body?.attachment_original_name === 'string' && body.attachment_original_name
        ? body.attachment_original_name
        : null
    const activity_id = typeof body?.activity_id === 'string' && body.activity_id ? body.activity_id : null
    const requirement_type = normalizeRequirementType(body?.requirement_type, body?.is_mandatory === true)

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    const insertPayload = {
      project_id: projectId,
      activity_id,
      name,
      description: description || null,
      deadline_at,
      attachment_path,
      attachment_original_name: attachment_path ? attachment_original_name : null,
      attachment_missing_at: null,
      attachment_missing_checked_at: null,
      requirement_type,
      is_mandatory: requirementTypeToMandatory(requirement_type),
      created_by: access.profile.id,
      status: 'pending',
    }

    const { data, error } = await admin
      .from('document_requirements')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      console.error('POST document-requests error:', error)
      return NextResponse.json({ error: 'Failed to create document request' }, { status: 500 })
    }

    await logAction({
      actorId: access.user.id,
      actionType: 'create',
      entityType: 'document',
      entityId: data?.id ?? null,
      entityName: name,
      oldValues: null,
      newValues: insertPayload,
      description: `${access.profile.email || 'User'} a creat cererea de document "${name}"`,
      request,
    })

    return NextResponse.json({ ok: true, id: data?.id })
  } catch (e: any) {
    console.error('POST document-requests exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
