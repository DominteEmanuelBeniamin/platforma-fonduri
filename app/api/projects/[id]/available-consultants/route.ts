import { NextResponse } from 'next/server'
import { supabaseAdmin, requireAdmin } from '../../../_utils/auth'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }

    // Admin-only
    const admin = await requireAdmin(request)
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status })
    }

    // Project exists?
    const { data: project, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .single()

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Existing member consultant ids
    const { data: members, error: membersErr } = await supabaseAdmin
      .from('project_members')
      .select('consultant_id')
      .eq('project_id', projectId)

    if (membersErr) {
      return NextResponse.json({ error: 'Failed to load project members' }, { status: 500 })
    }

    const excludedIds = (members ?? []).map(m => m.consultant_id).filter(Boolean)

    // Consultants not already in this project
    let query = supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('role', 'consultant')
      .order('full_name', { ascending: true })

    if (excludedIds.length > 0) {
      // IMPORTANT: uneori trebuie ghilimele în lista de UUID-uri. Dacă primești eroare, zi-mi.
      query = query.not('id', 'in', `(${excludedIds.join(',')})`)
    }

    const { data: consultants, error: consErr } = await query

    if (consErr) {
      return NextResponse.json({ error: consErr.message }, { status: 400 })
    }

    return NextResponse.json({ consultants: consultants ?? [] })
  } catch (e: any) {
    console.error('GET /api/projects/[id]/available-consultants error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
