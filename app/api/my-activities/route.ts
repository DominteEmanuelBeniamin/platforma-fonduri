/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireProfile, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

// GET /api/my-activities
// Returnează activitățile asignate utilizatorului curent (consultant)
export async function GET(request: Request) {
  try {
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()

    const { data: activities, error } = await admin
      .from('project_activities')
      .select(`
        id,
        name,
        deadline_at,
        phase:phase_id (
          id,
          name,
          project:project_id (
            id,
            title
          )
        )
      `)
      .eq('assigned_to', ctx.profile.id)
      .order('deadline_at', { ascending: true, nullsFirst: false })

    if (error) {
      console.error('GET my-activities error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Numărăm cererile de documente pentru fiecare activitate
    const activitiesWithCounts = await Promise.all(
      (activities ?? []).map(async (act: any) => {
        const { count } = await admin
          .from('document_requirements')
          .select('id', { count: 'exact', head: true })
          .eq('activity_id', act.id)
          .in('status', ['pending', 'review'])

        return {
          id: act.id,
          name: act.name,
          deadline_at: act.deadline_at,
          phase_name: (act.phase as any)?.name ?? null,
          project_id: (act.phase as any)?.project?.id ?? null,
          project_title: (act.phase as any)?.project?.title ?? null,
          pending_docs: count ?? 0,
        }
      })
    )

    return NextResponse.json({ activities: activitiesWithCounts })
  } catch (e: any) {
    console.error('GET my-activities exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
