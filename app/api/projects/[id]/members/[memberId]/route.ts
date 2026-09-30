import { NextResponse } from 'next/server'
import { requireProjectManager, guardToResponse } from '../../../../_utils/auth'
import { createSupabaseServiceClient } from '../../../../_utils/supabase'
import { logAction } from '../../../../_utils/audit'


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

    // 1) Admin sau consultant senior membru
    const ctx = await requireProjectManager(request, projectId)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()


    // 2) Verificăm că membership-ul există și aparține proiectului
    const { data: existing, error: findErr } = await admin
      .from('project_members')
      .select('id, project_id, consultant_id, role_in_project')
      .eq('id', memberId)
      .maybeSingle()

    if (findErr || !existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (existing.project_id !== projectId) {
      return NextResponse.json({ error: 'Member does not belong to this project' }, { status: 400 })
    }

    const [{ data: projectRow }, { data: consultantProfile }] = await Promise.all([
      admin.from('projects').select('title').eq('id', projectId).maybeSingle(),
      admin.from('profiles').select('full_name, email, consultant_level').eq('id', existing.consultant_id).maybeSingle(),
    ])
    const projectTitle = projectRow?.title ?? projectId
    const consultantLabel =
      consultantProfile?.email ?? consultantProfile?.full_name ?? existing.consultant_id

    // Seniorul scoate doar juniori: nu alt senior și nici pe el însuși.
    // Adminul poate scoate pe oricine; restul regulilor le aplică baza.
    if (ctx.access.role !== 'admin') {
      if (existing.consultant_id === ctx.user.id) {
        return NextResponse.json(
          { error: 'Forbidden: nu te poți scoate singur din echipă', reason: 'self' },
          { status: 403 }
        )
      }
      if (consultantProfile?.consultant_level === 'senior') {
        return NextResponse.json(
          { error: 'Forbidden: un consultant senior nu poate scoate alt senior', reason: 'senior' },
          { status: 403 }
        )
      }
    }

    // 3) Ștergere
    const { error: delErr } = await admin.rpc('remove_project_member_if_unassigned', {
      p_project_id: projectId,
      p_member_id: memberId,
    })

    if (delErr) {
      if (delErr.code === 'P0002') {
        return NextResponse.json({ error: delErr.message }, { status: 404 })
      }
      if (delErr.code === 'P0001') {
        // `reason` rămâne lizibil pentru interfață: apiFetch înlocuiește
        // `error` cu un mesaj generic, ca textul bazei să nu ajungă la utilizator.
        const message = delErr.message.toLowerCase()
        const reason = message.includes('general consultant')
          ? 'general_consultant'
          : message.includes('document request')
          ? 'assigned_request'
          : message.includes('activity')
          ? 'assigned_activity'
          : 'blocked'
        return NextResponse.json({ error: delErr.message, reason }, { status: 409 })
      }
      console.error('Remove project member RPC error:', delErr)
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }

    await logAction({
      actorId: ctx.user.id,
      actionType: 'delete',
      entityType: 'project_member',
      entityId: memberId,
      entityName: consultantLabel,
      oldValues: {
        ...existing,
        project_title: projectTitle,
        consultant_name: consultantProfile?.full_name ?? null,
        consultant_email: consultantProfile?.email ?? null,
      },
      description: `Scoatere membru ${consultantLabel} din proiectul "${projectTitle}"`,
      request,
    })

    return NextResponse.json({ message: 'Member removed' })
  } catch (e: unknown) {
    console.error('DELETE /api/projects/[id]/members/[memberId] error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
