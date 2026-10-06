// Finalizarea și readucerea în lucru a fazelor și activităților (#109).
//
// Patru rute (`complete`/`reopen`, pe fază și pe activitate) cu aceeași formă:
// gardă de manager de proiect, update condiționat pe starea citită, data și
// autorul scrise sau golite împreună, audit. Scrise o dată aici, ca cele patru
// să nu poată începe să se poarte diferit.
import { NextResponse } from 'next/server'
import { guardToResponse, requireProjectManager } from './auth'
import { logAction } from './audit'
import { createSupabaseServiceClient } from './supabase'
import { completeRefusal, reopenRefusal } from '@/lib/completion'
import { isUuid } from '@/lib/notification-utils'

type Target =
  | { kind: 'phase'; projectId: string; phaseId: string }
  | { kind: 'activity'; projectId: string; phaseId: string; activityId: string }

type Action = 'complete' | 'reopen'

const WORDS = {
  phase: { noun: 'faza', table: 'project_phases', entity: 'project_phase' },
  activity: { noun: 'activitatea', table: 'project_activities', entity: 'project_activity' },
} as const

const COLUMNS = 'id, name, status, started_at, completed_at, completed_by'

export async function changeItemCompletion(request: Request, target: Target, action: Action) {
  try {
    // Un id care nu e UUID ar ajunge ca eroare de Postgres, deci 500.
    const ids = target.kind === 'phase' ? [target.projectId, target.phaseId] : [target.projectId, target.phaseId, target.activityId]
    if (!ids.every(isUuid)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Doar adminul și seniorul membru marchează și redeschid (D1): juniorul și
    // clientul primesc 403 înainte să afle ceva despre starea elementului.
    const ctx = await requireProjectManager(request, target.projectId)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()
    const words = WORDS[target.kind]

    const { data: phase, error: phaseError } = await admin
      .from('project_phases')
      .select('id, name')
      .eq('id', target.phaseId)
      .eq('project_id', target.projectId)
      .maybeSingle()
    if (phaseError) throw phaseError
    if (!phase) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const itemId = target.kind === 'phase' ? target.phaseId : target.activityId
    let lookup = admin.from(words.table).select(COLUMNS).eq('id', itemId)
    lookup = target.kind === 'phase'
      ? lookup.eq('project_id', target.projectId)
      : lookup.eq('phase_id', target.phaseId)
    const { data: before, error: beforeError } = await lookup.maybeSingle()
    if (beforeError) throw beforeError
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const refusal = action === 'complete'
      ? completeRefusal(target.kind, before.status)
      : reopenRefusal(target.kind, before.status)
    if (refusal) {
      return NextResponse.json({ error: 'Invalid status transition', message: refusal.message }, { status: refusal.status })
    }

    const now = new Date().toISOString()
    // Redeschis = în lucru (D17); data de început rămâne neatinsă, inclusiv
    // când nu era (plan: „started_at păstrat”).
    const update = action === 'complete'
      ? { status: 'completed', completed_at: now, completed_by: ctx.user.id }
      : { status: 'in_progress', completed_at: null, completed_by: null }

    // Condiționat pe starea citită: din două apăsări simultane, una reușește,
    // cealaltă primește 409, iar auditul are un singur rând.
    const { data: item, error: updateError } = await admin
      .from(words.table)
      .update(update)
      .eq('id', itemId)
      .eq('status', before.status)
      .select(COLUMNS)
      .maybeSingle()
    if (updateError) throw updateError
    if (!item) {
      return NextResponse.json(
        { error: 'Concurrent status change', message: 'Starea s-a schimbat între timp. Reîncarcă pagina.' },
        { status: 409 },
      )
    }

    const { data: project } = await admin
      .from('projects')
      .select('title')
      .eq('id', target.projectId)
      .maybeSingle()
    const projectTitle = project?.title ?? target.projectId
    const actor = ctx.profile.email || 'Utilizator'
    const verb = action === 'complete'
      ? `a marcat ${words.noun} "${item.name}" ca finalizată`
      : `a readus ${words.noun} "${item.name}" în lucru`

    await logAction({
      actorId: ctx.user.id,
      actionType: action,
      entityType: words.entity,
      entityId: itemId,
      entityName: item.name,
      oldValues: {
        status: before.status,
        completed_at: before.completed_at,
        completed_by: before.completed_by,
        project_id: target.projectId,
        project_title: projectTitle,
        ...(target.kind === 'activity' ? { phase_id: target.phaseId, phase_name: phase.name } : {}),
      },
      newValues: {
        status: item.status,
        completed_at: item.completed_at,
        completed_by: item.completed_by,
        project_id: target.projectId,
        project_title: projectTitle,
        ...(target.kind === 'activity' ? { phase_id: target.phaseId, phase_name: phase.name } : {}),
      },
      description: `${actor} ${verb} în proiectul "${projectTitle}"`,
      request,
    })

    return NextResponse.json({ [target.kind]: item })
  } catch (e: unknown) {
    const err = e as Error
    console.error(`POST ${target.kind} ${action} error:`, err)
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}
