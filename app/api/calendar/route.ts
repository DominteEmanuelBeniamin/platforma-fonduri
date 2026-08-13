/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/calendar[?project_id=<uuid>]
//
// O singură rută pentru ambele calendare (#69). Fără `project_id` întoarce
// termenele din toate proiectele accesibile utilizatorului; cu el, doar dintr-un
// proiect. Două rute ar fi însemnat regulile de vizibilitate scrise de două ori.

import { NextResponse } from 'next/server'
import { guardToResponse, requireProfile, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { isClientVisibleActivity, isClientVisibleDocument, isClientVisiblePhase } from '@/lib/client-visibility'
import {
  GENERAL_PHASE_ID,
  isActivityDone,
  isRequestDone,
  requestOwnerId,
  type CalendarEvent,
  type CalendarPayload,
} from '@/lib/calendar'

type Admin = ReturnType<typeof createSupabaseServiceClient>

/** PostgREST întoarce relațiile many-to-one când ca obiect, când ca listă. */
const one = <T,>(relation: T | T[] | null | undefined): T | null =>
  (Array.isArray(relation) ? relation[0] : relation) ?? null

/** Plafonul implicit de rânduri al PostgREST pe acest proiect Supabase. */
const PAGE_SIZE = 1000

/**
 * Citește toate rândurile, pagină cu pagină.
 *
 * PostgREST taie tăcut la `PAGE_SIZE`: nu întoarce eroare, doar mai puține
 * rânduri. Pe un calendar, un termen lipsă nu arată ca o defecțiune, ci ca
 * „elementul n-are termen" — adică exact ca ceva ce nu trebuie urmărit. Deci
 * paginăm, în loc să ne bazăm pe faptul că azi încă încap toate.
 */
async function fetchAllRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${label}: ${error.message}`)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}

/**
 * Proiectele care intră în calendarul general. `null` = toate, pentru
 * administrator: e mai ieftin și mai sigur decât să trimitem înapoi în URL o
 * listă cu toate id-urile de proiect.
 */
async function accessibleProjectIds(
  admin: Admin,
  profile: { id: string; role: 'admin' | 'consultant' | 'client' },
): Promise<string[] | null> {
  if (profile.role === 'admin') return null

  // Apartenența consultantului stă în `project_members`. `general_consultant_id`
  // nu e sursă de acces — e gol pe aproape toate proiectele existente.
  const rows = await fetchAllRows<{ project_id: string }>('project_members', (from, to) =>
    admin.from('project_members').select('project_id').eq('consultant_id', profile.id).range(from, to)
  )
  return [...new Set(rows.map(row => row.project_id))]
}

const displayName = (profile?: { full_name?: string | null; email?: string | null } | null) =>
  profile?.full_name || profile?.email || null

export async function GET(request: Request) {
  try {
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const url = new URL(request.url)
    const projectId = url.searchParams.get('project_id')
    const role = ctx.profile.role
    const admin = createSupabaseServiceClient()

    // ── Ce proiecte intră în calendar. `null` = toate ────────────────────────
    let projectIds: string[] | null
    if (projectId) {
      const access = await requireProjectAccess(request, projectId)
      if (!access.ok) return guardToResponse(access)
      projectIds = [projectId]
    } else {
      // Calendarul general e o suprafață de lucru intern: clientul își vede
      // termenele în pagina proiectului lui, nu într-o vedere transversală.
      if (role === 'client') {
        // `apiFetch` rescrie `error` pe răspunsurile non-2xx; `message` trece
        // nealterat, deci motivul real ajunge la utilizator (convenția din #70).
        const reason = 'Calendarul general e pentru echipa de consultanță. Termenele tale sunt în pagina proiectului.'
        return NextResponse.json({ error: reason, message: reason }, { status: 403 })
      }
      projectIds = await accessibleProjectIds(admin, ctx.profile)
    }

    const empty: CalendarPayload = { events: [], projects: [], phases: [], role, user_id: ctx.profile.id }
    if (projectIds !== null && projectIds.length === 0) return NextResponse.json(empty)

    // Filtrul pe proiect se aplică doar când lista e restrânsă; pentru
    // administratorul care vede tot, absența lui e și mai ieftină.
    // `any`: tipurile generice ale builderului Supabase se instanțiază la
    // adâncime nefinită dacă trec printr-un helper generic.
    const scoped = (query: any, column: string): any =>
      projectIds === null ? query : query.in(column, projectIds)

    // ── Surse ────────────────────────────────────────────────────────────────
    const [projects, phases, requests, members] = await Promise.all([
      fetchAllRows<any>('projects', (from, to) =>
        scoped(
          admin
            .from('projects')
            .select('id, title, client_id, general_consultant_id, client:profiles!projects_client_id_fkey(id, full_name, email)'),
          'id',
        ).range(from, to)
      ),
      fetchAllRows<any>('project_phases', (from, to) =>
        scoped(
          admin.from('project_phases').select('id, name, order_index, visibility, project_id'),
          'project_id',
        ).order('order_index', { ascending: true }).range(from, to)
      ),
      fetchAllRows<any>('document_requirements', (from, to) =>
        scoped(
          admin
            .from('document_requirements')
            .select('id, name, status, deadline_at, visibility, assigned_to, activity_id, project_id, activity:activity_id(id, name, phase_id, visibility, assigned_to, phase:phase_id(id, name, visibility))'),
          'project_id',
        )
          .is('deleted_at', null)
          .eq('is_outgoing', false)
          .range(from, to)
      ),
      fetchAllRows<any>('project_members', (from, to) =>
        scoped(admin.from('project_members').select('project_id, consultant_id'), 'project_id').range(from, to)
      ),
    ])

    const phaseById = new Map(phases.map(phase => [phase.id, phase]))

    // Filtrarea prin resursa imbricată, nu printr-o listă de `phase_id`: lista
    // ar fi ajuns în URL-ul cererii și ar fi crescut cu fiecare fază.
    const activities = await fetchAllRows<any>('project_activities', (from, to) =>
      scoped(
        admin
          .from('project_activities')
          .select('id, name, status, completed_at, deadline_at, visibility, assigned_to, phase_id, phase:phase_id!inner(project_id)'),
        'phase.project_id',
      ).order('order_index', { ascending: true }).range(from, to)
    )

    const projectById = new Map(projects.map(project => [project.id, project]))

    // Consultantul general al proiectului contează ca responsabil doar dacă e
    // membru — aceeași condiție pe care o pune și publicarea (#70).
    const memberKeys = new Set(members.map((row: any) => `${row.project_id}:${row.consultant_id}`))
    const generalOwnerOf = (project: any): string | null => {
      const candidate = project?.general_consultant_id ?? null
      if (!candidate) return null
      return memberKeys.has(`${project.id}:${candidate}`) ? candidate : null
    }

    // ── Nume de responsabili, dintr-o singură interogare ──────────────────────
    const ownerOf = (req: any): string | null =>
      requestOwnerId({
        assigned_to: req.assigned_to,
        activity_id: req.activity_id,
        activity: one<any>(req.activity),
        generalOwnerId: generalOwnerOf(projectById.get(req.project_id)),
      })

    const ownerIds = new Set<string>()
    for (const activity of activities) if (activity.assigned_to) ownerIds.add(activity.assigned_to)
    for (const req of requests) {
      const owner = ownerOf(req)
      if (owner) ownerIds.add(owner)
    }

    const ownerById = new Map<string, { full_name: string | null; email: string | null }>()
    if (ownerIds.size > 0) {
      const owners = await fetchAllRows<any>('profiles', (from, to) =>
        admin.from('profiles').select('id, full_name, email').in('id', [...ownerIds]).range(from, to)
      )
      for (const owner of owners) ownerById.set(owner.id, owner)
    }

    // ── Evenimente ───────────────────────────────────────────────────────────
    const projectOf = (id: string) => projectById.get(id)
    const clientNameOf = (project: any) => displayName(one<any>(project?.client)) ?? null

    const events: CalendarEvent[] = []

    for (const activity of activities) {
      const phase = phaseById.get(activity.phase_id)
      if (!phase) continue
      // Clientul vede numai lanțul integral publicat: activitate + fază.
      if (role === 'client' && !isClientVisibleActivity({ ...activity, phase })) continue

      const project = projectOf(phase.project_id)
      events.push({
        id: activity.id,
        kind: 'activity',
        name: activity.name,
        deadline_at: activity.deadline_at ?? null,
        done: isActivityDone(activity),
        visibility: activity.visibility === 'published' ? 'published' : 'draft',
        project_id: phase.project_id,
        project_title: project?.title ?? '',
        client_name: clientNameOf(project),
        phase_id: phase.id,
        phase_name: phase.name,
        activity_id: activity.id,
        activity_name: activity.name,
        assignee_id: activity.assigned_to ?? null,
        assignee_name: displayName(ownerById.get(activity.assigned_to ?? '')),
        href: `/projects/${phase.project_id}?phase=${phase.id}&activity=${activity.id}`,
      })
    }

    for (const req of requests) {
      // Lanțul cerere → activitate → fază, exact ca în restul aplicației.
      if (role === 'client' && !isClientVisibleDocument(req)) continue

      const project = projectOf(req.project_id)
      const activity = one<any>(req.activity)
      const phase = one<any>(activity?.phase)
      const ownerId = ownerOf(req)

      const href = activity
        ? `/projects/${req.project_id}?phase=${activity.phase_id}&activity=${activity.id}&document=${req.id}`
        : `/projects/${req.project_id}?phase=${GENERAL_PHASE_ID}&document=${req.id}`

      events.push({
        id: req.id,
        kind: 'request',
        name: req.name,
        deadline_at: req.deadline_at ?? null,
        done: isRequestDone(req),
        visibility: req.visibility === 'published' ? 'published' : 'draft',
        project_id: req.project_id,
        project_title: project?.title ?? '',
        client_name: clientNameOf(project),
        phase_id: phase?.id ?? null,
        phase_name: phase?.name ?? null,
        activity_id: activity?.id ?? null,
        activity_name: activity?.name ?? null,
        assignee_id: ownerId,
        assignee_name: displayName(ownerById.get(ownerId ?? '')),
        href,
      })
    }

    const payload: CalendarPayload = {
      events,
      projects: projects
        .map(project => ({
          id: project.id,
          title: project.title,
          client_name: clientNameOf(project),
        }))
        .sort((a, b) => (a.client_name ?? '').localeCompare(b.client_name ?? '', 'ro') || a.title.localeCompare(b.title, 'ro')),
      // Filtrul de fază are sens doar în calendarul unui proiect; în cel general
      // îi ia locul filtrul de proiect.
      phases: projectId
        ? phases
            .filter(phase => role !== 'client' || isClientVisiblePhase(phase))
            .map(phase => ({ id: phase.id, name: phase.name, order_index: phase.order_index ?? 0 }))
        : [],
      role,
      user_id: ctx.profile.id,
    }

    return NextResponse.json(payload)
  } catch (e: any) {
    console.error('GET calendar exception:', e)
    return NextResponse.json({ error: 'Failed to load calendar' }, { status: 500 })
  }
}
