// Închiderea și redeschiderea unei cereri de documente (#109).
//
// O cerere închisă are starea `closed`, separată de „Aprobat": toate filtrele
// „e ceva de făcut aici" lucrează pe liste de stări permise, deci iese singură
// din remindere, din „Ce ai de făcut" și din încărcare. La redeschidere revine
// exact la starea dinainte, ținută în `status_before_close`.
import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectManager, requireUser } from './auth'
import { logAction } from './audit'
import { createSupabaseServiceClient } from './supabase'
import { requestCloseRefusal, requestReopenRefusal } from '@/lib/completion'
import { isUuid } from '@/lib/notification-utils'

type Action = 'close' | 'reopen'

const COLUMNS = 'id, project_id, name, status, is_outgoing, deleted_at, status_before_close, closed_at, closed_by'

export async function changeRequestClosure(request: Request, requestId: string, action: Action) {
  try {
    // Autentificarea înaintea oricărei citiri: fără token răspunsul e 401,
    // indiferent dacă cererea există, deci nu se poate afla ce id-uri există.
    const auth = await requireUser(request)
    if (!auth.ok) return guardToResponse(auth)
    if (!isUuid(requestId)) {
      return NextResponse.json({ error: 'Cererea nu a fost găsită', message: 'Cererea nu mai există.' }, { status: 404 })
    }
    const admin = createSupabaseServiceClient()

    const { data: before, error: beforeError } = await admin
      .from('document_requirements')
      .select(COLUMNS)
      .eq('id', requestId)
      .maybeSingle()
    if (beforeError) throw beforeError
    if (!before?.project_id) {
      return NextResponse.json({ error: 'Cererea nu a fost găsită', message: 'Cererea nu mai există.' }, { status: 404 })
    }

    // Doar adminul și seniorul membru închid și redeschid (D1). Garda vine
    // înaintea refuzurilor de stare, ca juniorul să primească 403 indiferent
    // de starea cererii.
    const ctx = await requireProjectManager(request, before.project_id, { write: true })
    if (!ctx.ok) return guardToResponse(ctx)

    const refusal = action === 'close' ? requestCloseRefusal(before) : requestReopenRefusal(before)
    if (refusal) {
      return NextResponse.json({ error: 'Invalid status transition', message: refusal.message }, { status: refusal.status })
    }

    const now = new Date().toISOString()
    const update = action === 'close'
      ? { status: 'closed', status_before_close: before.status, closed_at: now, closed_by: ctx.user.id }
      : { status: before.status_before_close, status_before_close: null, closed_at: null, closed_by: null }

    // Condiționat pe starea citită: o încărcare a clientului sau o verificare
    // apărută între timp câștigă, iar aici răspunsul e 409.
    const { data: updated, error: updateError } = await admin
      .from('document_requirements')
      .update(update)
      .eq('id', requestId)
      .eq('status', before.status)
      .is('deleted_at', null)
      .select(COLUMNS)
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) {
      return NextResponse.json(
        { error: 'Concurrent status change', message: 'Cererea s-a schimbat între timp. Reîncarcă pagina.' },
        { status: 409 },
      )
    }

    const { data: project } = await admin
      .from('projects')
      .select('title')
      .eq('id', before.project_id)
      .maybeSingle()
    const projectTitle = project?.title ?? before.project_id
    const actor = ctx.profile.email || 'Utilizator'
    const name = before.name || requestId

    await logAction({
      actorId: ctx.user.id,
      actionType: action,
      entityType: 'document',
      entityId: requestId,
      entityName: before.name || 'Cerere document',
      oldValues: {
        status: before.status,
        status_before_close: before.status_before_close,
        closed_at: before.closed_at,
        closed_by: before.closed_by,
        project_id: before.project_id,
        project_title: projectTitle,
      },
      newValues: {
        status: updated.status,
        status_before_close: updated.status_before_close,
        closed_at: updated.closed_at,
        closed_by: updated.closed_by,
        project_id: before.project_id,
        project_title: projectTitle,
      },
      description: action === 'close'
        ? `${actor} a închis cererea de document "${name}" din proiectul "${projectTitle}"`
        : `${actor} a redeschis cererea de document "${name}" din proiectul "${projectTitle}"`,
      request,
    })

    return NextResponse.json({ request: updated })
  } catch (e: unknown) {
    const err = e as Error
    console.error(`POST document request ${action} error:`, err)
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}
