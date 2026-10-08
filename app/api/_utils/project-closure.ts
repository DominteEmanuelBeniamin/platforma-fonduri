// Încheierea și redeschiderea unui proiect (#109).
//
// `lifecycle_status` se scrie doar de aici: PATCH-ul proiectului îl refuză, ca
// să nu existe un al doilea drum, fără audit. Cronul de remindere, calendarul
// general și listele „de făcut" citesc `isProjectActive`, deci încheierea le
// oprește pe toate odată.
import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectManager } from './auth'
import { logAction } from './audit'
import { createSupabaseServiceClient } from './supabase'
import {
  PROJECT_ALREADY_CLOSED_MESSAGE,
  PROJECT_CLOSE_REVIEW_FIRST_MESSAGE,
  PROJECT_NOT_CLOSED_MESSAGE,
} from '@/lib/project-lifecycle'
import { isUuid } from '@/lib/notification-utils'

type Action = 'close' | 'reopen'

const COLUMNS = 'id, title, lifecycle_status, closed_at, closed_by, closer:closed_by(id, full_name)'

export async function changeProjectLifecycle(request: Request, projectId: string, action: Action) {
  try {
    // Un id care nu e UUID ar ajunge ca eroare de Postgres, deci 500.
    if (!isUuid(projectId)) return NextResponse.json({ error: 'Project not found', message: 'Proiectul nu există.' }, { status: 404 })
    // Adminul și seniorul membru (D7: doar din pagina proiectului).
    const ctx = await requireProjectManager(request, projectId)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()
    const { data: before, error: beforeError } = await admin
      .from('projects')
      .select('id, title, lifecycle_status, closed_at, closed_by')
      .eq('id', projectId)
      .maybeSingle()
    if (beforeError) throw beforeError
    if (!before) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const from = action === 'close' ? 'active' : 'completed'
    const refusalMessage = action === 'close' ? PROJECT_ALREADY_CLOSED_MESSAGE : PROJECT_NOT_CLOSED_MESSAGE
    if (before.lifecycle_status !== from) {
      return NextResponse.json({ error: 'Invalid lifecycle transition', message: refusalMessage }, { status: 409 })
    }

    // Un proiect încheiat se poate doar consulta, deci nici documentele nu se
    // mai verifică: cele „În verificare" se aprobă sau se resping înainte
    // (decizia din 8 octombrie 2026).
    if (action === 'close') {
      const { count: inReview, error: reviewError } = await admin
        .from('document_requirements')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'review')
        .is('deleted_at', null)
      if (reviewError) throw reviewError
      if (inReview) {
        return NextResponse.json(
          { error: 'Documents awaiting review', message: PROJECT_CLOSE_REVIEW_FIRST_MESSAGE(inReview) },
          { status: 409 },
        )
      }
    }

    const now = new Date().toISOString()
    const update = action === 'close'
      ? { lifecycle_status: 'completed', closed_at: now, closed_by: ctx.user.id }
      : { lifecycle_status: 'active', closed_at: null, closed_by: null }

    // Condiționat pe starea citită: la dublu click sau din două taburi, una
    // dintre cereri reușește, cealaltă primește 409, cu un singur rând de audit.
    const { data: project, error: updateError } = await admin
      .from('projects')
      .update(update)
      .eq('id', projectId)
      .eq('lifecycle_status', from)
      .select(COLUMNS)
      .maybeSingle()
    if (updateError) throw updateError
    if (!project) {
      return NextResponse.json({ error: 'Invalid lifecycle transition', message: refusalMessage }, { status: 409 })
    }

    const actor = ctx.profile.email || 'Utilizator'
    await logAction({
      actorId: ctx.user.id,
      actionType: action,
      entityType: 'project',
      entityId: projectId,
      entityName: project.title,
      oldValues: {
        lifecycle_status: before.lifecycle_status,
        closed_at: before.closed_at,
        closed_by: before.closed_by,
      },
      newValues: {
        lifecycle_status: project.lifecycle_status,
        closed_at: project.closed_at,
        closed_by: project.closed_by,
      },
      description: action === 'close'
        ? `${actor} a încheiat proiectul "${project.title}"`
        : `${actor} a redeschis proiectul "${project.title}"`,
      request,
    })

    return NextResponse.json({ project })
  } catch (e: unknown) {
    const err = e as Error
    console.error(`POST project ${action} error:`, err)
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}
