/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id:projectId } = await params

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
        attachment_path,
        deadline_at,
        created_by,
        created_at,
        creator:created_by(full_name, email),
        activity:activity_id(id, name, phase_id),
        files(
          id,
          storage_path,
          version_number,
          comments,
          created_at,
          uploaded_by
        )
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('GET document-requests error:', error)
      return NextResponse.json({ error: 'Failed to load document requests' }, { status: 500 })
    }

    return NextResponse.json({ requests: data ?? [] })
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
    const { id:projectId } = await params

    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return guardToResponse(access)

    // doar admin/consultant pot crea cereri
    if (access.profile.role !== 'admin' && access.profile.role !== 'consultant') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const description = typeof body?.description === 'string' ? body.description.trim() : null
    const deadline_at = typeof body?.deadline_at === 'string' && body.deadline_at ? body.deadline_at : null
    const attachment_path = typeof body?.attachment_path === 'string' && body.attachment_path ? body.attachment_path : null
    const activity_id = typeof body?.activity_id === 'string' && body.activity_id ? body.activity_id : null
    const is_mandatory = body?.is_mandatory === true

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    const { data, error } = await admin
      .from('document_requirements')
      .insert({
        project_id: projectId,
        activity_id,
        name,
        description: description || null,
        deadline_at,
        attachment_path,
        is_mandatory,
        created_by: access.profile.id,
        status: 'pending'
      })
      .select('id')
      .single()

    if (error) {
      console.error('POST document-requests error:', error)
      return NextResponse.json({ error: 'Failed to create document request' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: data?.id })
  } catch (e: any) {
    console.error('POST document-requests exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}