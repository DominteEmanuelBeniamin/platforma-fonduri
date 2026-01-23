import { NextResponse } from 'next/server'
import { requireAuth, requireAdmin, supabaseAdmin } from '../../../_utils/auth'
import { requireProjectAccess } from '../../../_utils/projectAccess'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    // 1) Admin-only
    const admin = await requireAdmin(request)
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status })
    }

    // 2) Body
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const consultant_id = (body as any).consultant_id
    if (typeof consultant_id !== 'string' || consultant_id.trim().length === 0) {
      return NextResponse.json({ error: 'consultant_id must be a non-empty string' }, { status: 400 })
    }

    const cleanConsultantId = consultant_id.trim()

    // 3) Verificăm proiectul există
    const { data: project, error: projectErr } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .single()

    if (projectErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // 4) Verificăm consultantul există și are rol consultant
    const { data: consultantProfile, error: consultantErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role, email, full_name')
      .eq('id', cleanConsultantId)
      .single()

    if (consultantErr || !consultantProfile) {
      return NextResponse.json({ error: 'Consultant not found' }, { status: 404 })
    }

    if (consultantProfile.role !== 'consultant') {
      return NextResponse.json({ error: 'User is not a consultant' }, { status: 400 })
    }

    // 5) Verificăm dacă nu e deja membru
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('consultant_id', cleanConsultantId)
      .maybeSingle()

    if (existingErr) {
      return NextResponse.json({ error: 'Failed to check existing membership' }, { status: 500 })
    }

    if (existing) {
      return NextResponse.json({ error: 'Consultant is already a member of this project' }, { status: 409 })
    }

    // 6) Inserăm membership
    const { data: member, error: insertErr } = await supabaseAdmin
      .from('project_members')
      .insert({
        project_id: projectId,
        consultant_id: cleanConsultantId
        // dacă ai coloane extra (created_by, created_at etc.), le poți seta aici
      })
      .select(`
        *,
        profiles:consultant_id (
          id,
          email,
          full_name,
          role
        )
      `)
      .single()

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 400 })
    }

    return NextResponse.json({ message: 'Member added', member }, { status: 201 })
  } catch (e: any) {
    console.error('POST /api/projects/[id]/members error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    const auth = await requireAuth(request)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const access = await requireProjectAccess(projectId, auth.user.id)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const { data, error } = await supabaseAdmin
      .from('project_members')
      .select(`
        *,
        profiles:consultant_id (
          id, email, full_name, role
        )
      `)
      .eq('project_id', projectId)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ members: data ?? [] })
  } catch (e: any) {
    console.error('GET /api/projects/[id]/members error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
