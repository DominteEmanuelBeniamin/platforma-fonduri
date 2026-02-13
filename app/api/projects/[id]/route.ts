/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/projects/[id]/route.ts
import { NextResponse } from 'next/server'
import { guardToResponse, requireAdmin, requireProjectAccess } from '../../_utils/auth'
import { createSupabaseServiceClient } from '../../_utils/supabase'
import { logProjectAction, getClientIP, getUserAgent } from '../../_utils/audit'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    if (!projectId) {
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    // Doar admin poate edita proiecte
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()

    // 1. Citim proiectul curent (pentru audit)
    const { data: oldProject, error: findErr } = await admin
      .from('projects')
      .select('id, title, status, client_id, cod_intern, profiles(email, full_name, cif)')
      .eq('id', projectId)
      .maybeSingle()

    if (findErr) {
      console.error('Find project error:', findErr)
      return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
    }
    if (!oldProject) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // 2. Parsăm body-ul
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { title, status, client_id } = body as { title?: unknown; status?: unknown; client_id?: unknown }

    const update: Record<string, any> = {}

    // Validare title
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 })
      }
      if (title.trim().length > 120) {
        return NextResponse.json({ error: 'title is too long (max 120 chars)' }, { status: 400 })
      }
      update.title = title.trim()
    }

    // Validare status
    if (status !== undefined) {
      if (typeof status !== 'string' || status.trim().length === 0) {
        return NextResponse.json({ error: 'status must be a non-empty string' }, { status: 400 })
      }
      const allowedStatuses = ['contractare', 'implementare', 'monitorizare']
      if (!allowedStatuses.includes(status.trim())) {
        return NextResponse.json({ 
          error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` 
        }, { status: 400 })
      }
      update.status = status.trim()
    }

    // Validare client_id
    if (client_id !== undefined) {
      if (typeof client_id !== 'string' || client_id.trim().length === 0) {
        return NextResponse.json({ error: 'client_id must be a non-empty string' }, { status: 400 })
      }
      
      // Verificăm că noul client există și are rol=client
      const { data: newClient, error: clientErr } = await admin
        .from('profiles')
        .select('id, role, email, full_name')
        .eq('id', client_id.trim())
        .maybeSingle()
      
      if (clientErr) {
        console.error('Client lookup error:', clientErr)
        return NextResponse.json({ error: 'Failed to validate client' }, { status: 500 })
      }
      if (!newClient) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
      if (newClient.role !== 'client') {
        return NextResponse.json({ error: 'Selected user is not a client' }, { status: 400 })
      }
      
      update.client_id = client_id.trim()
    }

    // Dacă nu avem nimic de actualizat
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ 
        error: 'Nothing to update. Allowed fields: title, status, client_id' 
      }, { status: 400 })
    }

    // 3. Facem update-ul
    const { data: updatedProject, error: updateErr } = await admin
      .from('projects')
      .update(update)
      .eq('id', projectId)
      .select('*, profiles(full_name, cif, email)')
      .single()

    if (updateErr) {
      console.error('Update project error:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 400 })
    }

    // Construim old/new values doar cu ce s-a schimbat
    const oldValues: Record<string, unknown> = {}
    const newValues: Record<string, unknown> = {}
    
    for (const key of Object.keys(update)) {
      if (oldProject[key as keyof typeof oldProject] !== update[key]) {
        oldValues[key] = oldProject[key as keyof typeof oldProject]
        newValues[key] = update[key]
      }
    }

    // Descriere detaliată
    const adminEmail = (ctx.profile as { email?: string | null }).email || 'Admin'
    let description = `${adminEmail} a modificat proiectul "${oldProject.title}"`
    if (update.status && oldProject.status !== update.status) {
      description = `${adminEmail} a schimbat statusul proiectului "${oldProject.title}" din "${oldProject.status}" în "${update.status}"`
    } else if (update.title && oldProject.title !== update.title) {
      description = `${adminEmail} a redenumit proiectul din "${oldProject.title}" în "${update.title}"`
    } else if (update.client_id && oldProject.client_id !== update.client_id) {
      description = `${adminEmail} a schimbat clientul proiectului "${oldProject.title}"`
    }

    await logProjectAction({
      adminId: ctx.user.id,
      actionType: 'update',
      projectId: projectId,
      projectTitle: updatedProject.title,
      oldValues: Object.keys(oldValues).length > 0 ? oldValues : null,
      newValues: Object.keys(newValues).length > 0 ? newValues : null,
      description,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request)
    })

    return NextResponse.json({ 
      message: 'Project updated', 
      project: updatedProject 
    })
  } catch (e: unknown) {
    const err = e as Error
    console.error('PATCH /api/projects/[id] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()

    // 1. Citim datele proiectului ÎNAINTE de ștergere (pentru audit)
    const { data: project, error: findErr } = await admin
      .from('projects')
      .select('id, title, client_id, status, cod_intern, profiles(email, full_name, cif)')
      .eq('id', projectId)
      .maybeSingle()

    if (findErr) {
      console.error('Find project error:', findErr)
      return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
    }
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Helper pentru a extrage safe client info (fix pentru TypeScript)
    const clientProfile = Array.isArray(project.profiles) 
      ? project.profiles[0] 
      : project.profiles
    
    const clientEmail = clientProfile?.email || 'N/A'
    const clientName = clientProfile?.full_name || 'N/A'
    const clientCif = clientProfile?.cif || 'N/A'

    // 2. Storage cleanup (înainte de delete DB)
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

    // 3. Delete DB (cascade va șterge members, requirements, files)
    const { error: delErr } = await admin.from('projects').delete().eq('id', projectId)

    if (delErr) {
      console.error('Delete project error:', delErr)
      return NextResponse.json({ error: delErr.message }, { status: 400 })
    }

    // 4. AUDIT LOG - Ștergere proiect
    await logProjectAction({
      adminId: ctx.user.id,
      actionType: 'delete',
      projectId: project.id,
      projectTitle: project.title,
      oldValues: {
        title: project.title,
        client_id: project.client_id,
        client_email: clientEmail,
        client_name: clientName,
        client_cif: clientCif,
        status: project.status,
        cod_intern: project.cod_intern,
        files_deleted: uniquePaths.length
      },
      newValues: null,
      description: `${(ctx.profile as { email?: string | null }).email || 'Admin'} a șters proiectul "${project.title}" (client: ${clientEmail}, ${uniquePaths.length} fișiere șterse)`,
      ipAddress: getClientIP(request),
      userAgent: getUserAgent(request)
    })

    return NextResponse.json({ message: 'Project deleted' })
  } catch (e: unknown) {
    const err = e as Error
    console.error('DELETE /api/projects/[id] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}