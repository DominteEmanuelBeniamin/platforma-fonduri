import { NextResponse } from 'next/server'
import { guardToResponse, requireAdmin } from '../../../_utils/auth'
import { createSupabaseServiceClient } from '../../../_utils/supabase'

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
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()

    // Project exists?
    const { data: project, error: projErr } = await admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle()

    if (projErr) {
      console.error('Project lookup error:', projErr)
      return NextResponse.json({ error: 'Failed to load project' }, { status: 500 })
    }
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Existing member consultant ids
    const { data: members, error: membersErr } = await admin
      .from('project_members')
      .select('consultant_id')
      .eq('project_id', projectId)

    if (membersErr) {
      console.error('Members lookup error:', membersErr)
      return NextResponse.json({ error: 'Failed to load project members' }, { status: 500 })
    }

    const excludedIds = (members ?? [])
      .map(m => m.consultant_id)
      .filter((x): x is string => typeof x === 'string' && x.length > 0)

    // Consultants not already in this project
    let query = admin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('role', 'consultant')
      .order('full_name', { ascending: true })


    if (excludedIds.length > 0) {
      const inList = `(${excludedIds.map(id => `"${id}"`).join(',')})`
      query = query.not('id', 'in', inList)
    }

    const { data: consultants, error: consErr } = await query

    if (consErr) {
      console.error('Consultants query error:', consErr)
      return NextResponse.json({ error: consErr.message }, { status: 400 })
    }

    return NextResponse.json({ consultants: consultants ?? [] })
  } catch (e: any) {
    console.error('GET /api/projects/[id]/available-consultants error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
