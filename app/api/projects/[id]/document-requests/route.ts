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
        name,
        description,
        status,
        attachment_path,
        deadline_at,
        created_by,
        created_at,
        creator:created_by(full_name, email),
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
  } catch (e: unknown) {
    const error = e as Error
    console.error('GET document-requests exception:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
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

    //doar admin/consultant pot crea cereri
    if (access.profile.role !== 'admin' && access.profile.role !== 'consultant') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const description = typeof body?.description === 'string' ? body.description.trim() : null
    const deadline_at = typeof body?.deadline_at === 'string' && body.deadline_at ? body.deadline_at : null
    const attachment_path = typeof body?.attachment_path === 'string' && body.attachment_path ? body.attachment_path : null

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()

    const { data, error } = await admin
      .from('document_requirements')
      .insert({
        project_id: projectId,
        name,
        description: description || null,
        deadline_at,
        attachment_path,
        created_by: access.profile.id,
        status: 'pending'
      })
      .select('id')
      .single()

    if (error) {
      console.error('POST document-requests error:', error)
      return NextResponse.json({ error: 'Failed to create document request' }, { status: 500 })
    }

    // Audit log pentru creare cerere document
    const ipAddress = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      null

    await admin
      .from('audit_logs')
      .insert({
        user_id: access.user.id,
        action_type: 'create',
        entity_type: 'document',
        entity_id: data.id,
        entity_name: name,
        new_values: {
          project_id: projectId,
          name,
          description,
          deadline_at,
          status: 'pending',
          has_attachment: !!attachment_path
        },
        description: `${access.profile.email || 'User'} a creat cererea de document "${name}" pentru proiectul ${projectId}`,
        ip_address: ipAddress
      })

    return NextResponse.json({ ok: true, id: data?.id })
  } catch (e: unknown) {
    const error = e as Error
    console.error('POST document-requests exception:', error)
    return NextResponse.json({ error: error?.message ?? 'Server error' }, { status: 500 })
  }
}