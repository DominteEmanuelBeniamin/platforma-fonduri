import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse} from '../../../../_utils/auth'
import { createSupabaseServiceClient } from '../../../../_utils/supabase'


export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: projectId, memberId } = await params

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID lipsește din URL' }, { status: 400 })
    }
    if (!memberId) {
      return NextResponse.json({ error: 'Member ID lipsește din URL' }, { status: 400 })
    }

    // 1) Admin-only
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)
    
    const admin = createSupabaseServiceClient()


    // 2) Verificăm că membership-ul există și aparține proiectului
    const { data: existing, error: findErr } = await admin
      .from('project_members')
      .select('id, project_id')
      .eq('id', memberId)
      .maybeSingle()

    if (findErr || !existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (existing.project_id !== projectId) {
      return NextResponse.json({ error: 'Member does not belong to this project' }, { status: 400 })
    }

    // 3) Ștergere
    const { error: delErr } = await admin
      .from('project_members')
      .delete()
      .eq('id', memberId)

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 })
    }

    return NextResponse.json({ message: 'Member removed' })
  } catch (e: any) {
    console.error('DELETE /api/projects/[id]/members/[memberId] error:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
