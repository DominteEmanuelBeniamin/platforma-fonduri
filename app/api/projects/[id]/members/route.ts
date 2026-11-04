import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectAccess, requireProjectManager } from '../../../_utils/auth'
import { createSupabaseServiceClient } from '../../../_utils/supabase'
import { logAction } from '../../../_utils/audit'
import { inactiveReferenceConflict } from '../../../_utils/inactive-reference'
import { userLifecycleConflict } from '../../../_utils/user-lifecycle'

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0
}

/**
 * GET /api/projects/:id/members
 * - admin: vede toți membrii
 * - consultant: doar dacă e membru în proiect
 * - client: doar dacă proiectul e al lui
 */
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

    const { data, error } = await admin
      .from('project_members')
      .select(
        `
        id,
        project_id,
        consultant_id,
        role_in_project,
        created_at,
        profiles:consultant_id (
          id,
          email,
          full_name,
          role,
          consultant_level,
          is_active,
          creation_pending
        )
      `
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Members list error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ members: data ?? [] })
  } catch (e: unknown) {
    console.error('GET /api/projects/[id]/members error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

/**
 * POST /api/projects/:id/members
 * admin sau consultant senior membru: adaugă un consultant ca membru în proiect
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const preparing = body.prepare_reopen === true
    if (preparing && Object.keys(body).some(key => !['prepare_reopen', 'consultant_id'].includes(key))) {
      return NextResponse.json({ error: 'Pregătirea redeschiderii permite doar adăugarea unui membru.' }, { status: 400 })
    }
    const ctx = await requireProjectManager(request, projectId, { write: !preparing })
    if (!ctx.ok) return guardToResponse(ctx)
    if (preparing && ctx.access.role !== 'admin') return NextResponse.json({ error: 'Doar administratorul pregătește redeschiderea.' }, { status: 403 })

    const consultant_id = (body as { consultant_id?: unknown }).consultant_id
    if (!isNonEmptyString(consultant_id)) {
      return NextResponse.json({ error: 'consultant_id must be a non-empty string' }, { status: 400 })
    }

    const cleanConsultantId = consultant_id.trim()
    const admin = createSupabaseServiceClient()

    // 1) Verificăm proiectul există (opțional, dar bun pentru 404 explicit)
    const { data: project, error: projectErr } = await admin
      .from('projects')
      .select('id, title')
      .eq('id', projectId)
      .maybeSingle()

    if (projectErr) {
      console.error('Project lookup error:', projectErr)
      return NextResponse.json({ error: 'Failed to load project' }, { status: 500 })
    }
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    const projectTitle = project.title ?? projectId

    // 2) Verificăm consultantul există și are rol consultant
    const { data: consultantProfile, error: consultantErr } = await admin
      .from('profiles')
      .select('id, role, email, full_name, is_active, creation_pending')
      .eq('id', cleanConsultantId)
      .maybeSingle()

    if (consultantErr) {
      console.error('Consultant lookup error:', consultantErr)
      return NextResponse.json({ error: 'Failed to load consultant' }, { status: 500 })
    }
    if (!consultantProfile) {
      return NextResponse.json({ error: 'Consultant not found' }, { status: 404 })
    }
    if (consultantProfile.role !== 'consultant') {
      return NextResponse.json({ error: 'User is not a consultant' }, { status: 400 })
    }
    if (consultantProfile.is_active !== true || consultantProfile.creation_pending) {
      return NextResponse.json({ error: 'Doar consultanții activi pot fi adăugați în proiect.' }, { status: 409 })
    }

    // 3) Verificăm dacă nu e deja membru
    const { data: existing, error: existingErr } = await admin
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('consultant_id', cleanConsultantId)
      .maybeSingle()

    if (existingErr) {
      console.error('Existing membership check error:', existingErr)
      return NextResponse.json({ error: 'Failed to check existing membership' }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json(
        { error: 'Consultant is already a member of this project' },
        { status: 409 }
      )
    }

    // 4) Inserăm membership
    const { data: member, error: insertErr } = await admin
      .from('project_members')
      .insert({
        project_id: projectId,
        consultant_id: cleanConsultantId,
        role_in_project: 'member',
      })
      .select(
        `
        id,
        project_id,
        consultant_id,
        role_in_project,
        created_at,
        profiles:consultant_id (
          id,
          email,
          full_name,
          role,
          consultant_level,
          is_active,
          creation_pending
        )
      `
      )
      .single()

    if (insertErr) {
      const conflict = userLifecycleConflict(insertErr)
      if (conflict) return NextResponse.json(conflict.body, { status: conflict.status })
      console.error('Insert membership error:', insertErr)
      const inactive = inactiveReferenceConflict(insertErr, 'Nu poți adăuga un cont dezactivat în echipa proiectului.')
      if (inactive) return NextResponse.json(inactive.body, { status: inactive.status })
      return NextResponse.json({ error: insertErr.message }, { status: 400 })
    }

    await logAction({
      actorId: ctx.user.id,
      actionType: 'create',
      entityType: 'project_member',
      entityId: member.id,
      entityName: consultantProfile.email ?? consultantProfile.full_name ?? cleanConsultantId,
      newValues: {
        project_id: projectId,
        project_title: projectTitle,
        consultant_id: cleanConsultantId,
        consultant_name: consultantProfile.full_name ?? null,
        consultant_email: consultantProfile.email ?? null,
        role_in_project: 'member',
      },
      description: `Adaugare membru ${consultantProfile.email ?? consultantProfile.full_name ?? cleanConsultantId} in proiectul "${projectTitle}"`,
      request,
    })

    return NextResponse.json({ message: 'Member added', member }, { status: 201 })
  } catch (e: unknown) {
    console.error('POST /api/projects/[id]/members error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
