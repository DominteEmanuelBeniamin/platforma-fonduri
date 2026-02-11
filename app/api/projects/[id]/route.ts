import { NextResponse } from 'next/server'
import { guardToResponse, requireAdmin, requireProjectAccess } from '../../_utils/auth'
import { createSupabaseServiceClient } from '../../_utils/supabase'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const {id : projectId} = await params
    if (!projectId ) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    const ctx = await requireProjectAccess(request, projectId)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()

    const { data: project, error } = await admin
      .from('projects')
      .select('*, profiles(*)')
      .eq('id', projectId)
      .maybeSingle()

    if (error) {
      console.error('Fetch project error:', error)
      return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
    }

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({ project })
  } catch (e: unknown) {
    const err = e as Error
    console.error('GET /api/projects/[id] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const {id: projectId} = await params
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()

    // Obține datele proiectului pentru audit
    const { data: project, error: findErr } = await admin
      .from('projects')
      .select('id, title, status, client_id, profiles(email, full_name)')
      .eq('id', projectId)
      .maybeSingle()

    if (findErr) {
      console.error('Find project error:', findErr)
      return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
    }
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Storage cleanup
    const bucket = 'project-files'

    const { data: fileRows, error: filesErr } = await admin
      .from('files')
      .select('storage_path, document_requirements!inner(project_id)')
      .eq('document_requirements.project_id', projectId)

    if (filesErr) {
      console.error('Fetch files paths error:', filesErr)
      return NextResponse.json({ error: 'Failed to load project files' }, { status: 500 })
    }

    const { data: attachments, error: attErr } = await admin
      .from('document_requirements')
      .select('attachment_path')
      .eq('project_id', projectId)
      .not('attachment_path', 'is', null)

    if (attErr) {
      console.error('Fetch attachment paths error:', attErr)
      return NextResponse.json({ error: 'Failed to load project attachments' }, { status: 500 })
    }

    const paths = [
      ...(fileRows ?? []).map(r => r.storage_path).filter((p): p is string => typeof p === 'string' && p.length > 0),
      ...(attachments ?? []).map(r => r.attachment_path).filter((p): p is string => typeof p === 'string' && p.length > 0),
    ]

    const uniquePaths = Array.from(new Set(paths))

    if (uniquePaths.length > 0) {
      const { error: removeErr } = await admin.storage.from(bucket).remove(uniquePaths)
      if (removeErr) {
        console.error('Storage remove error:', removeErr)
        return NextResponse.json({ error: 'Failed to remove storage objects' }, { status: 500 })
      }
    }

    // Delete from DB
    const { error: delErr } = await admin.from('projects').delete().eq('id', projectId)

    if (delErr) {
      console.error('Delete project error:', delErr)
      return NextResponse.json({ error: delErr.message }, { status: 400 })
    }

    // AUDIT LOG
    const ipAddress = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      null

    const clientInfo = project.profiles as { email?: string; full_name?: string } | null

    await admin
      .from('audit_logs')
      .insert({
        user_id: ctx.user.id,
        action_type: 'delete',
        entity_type: 'project',
        entity_id: projectId,
        entity_name: project.title,
        old_values: {
          title: project.title,
          status: project.status,
          client_id: project.client_id,
          client_email: clientInfo?.email,
          client_name: clientInfo?.full_name,
          files_deleted: uniquePaths.length
        },
        new_values: null,
        description: `${ctx.profile.email} a sters proiectul "${project.title}" (client: ${clientInfo?.email || 'necunoscut'}, ${uniquePaths.length} fisiere sterse)`,
        ip_address: ipAddress
      })

    return NextResponse.json({ message: 'Project deleted' })
  } catch (e: unknown) {
    const err = e as Error
    console.error('DELETE /api/projects/[id] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}

export async function PATCH() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 })
}