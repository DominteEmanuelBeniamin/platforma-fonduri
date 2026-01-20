import { NextResponse } from 'next/server'
import { supabaseAdmin, requireAuth } from '../../_utils/auth'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    // 1) Auth
    const auth = await requireAuth(request)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const callerId = auth.user.id

    // 2) Rol caller
    const { data: callerProfile, error: callerErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', callerId)
      .single()

    if (callerErr || !callerProfile) {
      return NextResponse.json({ error: 'Failed to verify caller role' }, { status: 500 })
    }

    // 3) Luăm proiectul (și info despre client, dacă vrei)
    const { data: project, error: projectErr } = await supabaseAdmin
      .from('projects')
      .select(`*, profiles(*)`)
      .eq('id', projectId)
      .single()

    if (projectErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // 4) Access control
    if (callerProfile.role === 'admin') {
      return NextResponse.json({ project })
    }

    if (callerProfile.role === 'client') {
      if (project.client_id !== callerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return NextResponse.json({ project })
    }

    if (callerProfile.role === 'consultant') {
      // consultant vede doar dacă e membru în project_members
      const { data: membership, error: memberErr } = await supabaseAdmin
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('consultant_id', callerId)
        .maybeSingle()

      if (memberErr) {
        return NextResponse.json({ error: 'Failed to verify project membership' }, { status: 500 })
      }

      if (!membership) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      return NextResponse.json({ project })
    }

    // Orice alt rol neprevăzut
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } catch (e: any) {
    console.error('GET /api/projects/[id] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
