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
  type CalendarEvent,
  type CalendarPayload,
} from '@/lib/calendar'

type Admin = ReturnType<typeof createSupabaseServiceClient>

/** PostgREST întoarce relațiile many-to-one când ca obiect, când ca listă. */
const one = <T,>(relation: T | T[] | null | undefined): T | null =>
  (Array.isArray(relation) ? relation[0] : relation) ?? null

/** Proiectele pe care utilizatorul le poate vedea în calendarul general. */
async function accessibleProjectIds(
  admin: Admin,
  profile: { id: string; role: 'admin' | 'consultant' | 'client' },
): Promise<string[]> {
  if (profile.role === 'admin') {
    const { data, error } = await admin.from('projects').select('id')
    if (error) throw error
    return (data ?? []).map((row: any) => row.id)
  }

  // Apartenența consultantului stă în `project_members`. `general_consultant_id`
  // nu e sursă de acces — e gol pe toate proiectele existente.
  const { data, error } = await admin
    .from('project_members')
    .select('project_id')
    .eq('consultant_id', profile.id)
  if (error) throw error
  return [...new Set((data ?? []).map((row: any) => row.project_id))]
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

    // ── Ce proiecte intră în calendar ────────────────────────────────────────
    let projectIds: string[]
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
    if (projectIds.length === 0) return NextResponse.json(empty)

    // ── Surse ────────────────────────────────────────────────────────────────
    const [projectsRes, phasesRes, requestsRes, membersRes] = await Promise.all([
      admin
        .from('projects')
        .select('id, title, client_id, general_consultant_id, client:profiles!projects_client_id_fkey(id, full_name, email)')
        .in('id', projectIds),
      admin
        .from('project_phases')
        .select('id, name, order_index, visibility, project_id')
        .in('project_id', projectIds)
        .order('order_index', { ascending: true }),
      admin
        .from('document_requirements')
        .select('id, name, status, deadline_at, visibility, assigned_to, activity_id, project_id, activity:activity_id(id, name, phase_id, visibility, assigned_to, phase:phase_id(id, name, visibility))')
        .in('project_id', projectIds)
        .is('deleted_at', null)
        .eq('is_outgoing', false),
      admin
        .from('project_members')
        .select('project_id, consultant_id')
        .in('project_id', projectIds),
    ])

    for (const res of [projectsRes, phasesRes, requestsRes, membersRes]) {
      if (res.error) {
        console.error('GET calendar source error:', res.error)
        return NextResponse.json({ error: 'Failed to load calendar' }, { status: 500 })
      }
    }

    const phases = (phasesRes.data ?? []) as any[]
    const phaseById = new Map(phases.map(phase => [phase.id, phase]))

    let activities: any[] = []
    if (phases.length > 0) {
      const { data, error } = await admin
        .from('project_activities')
        .select('id, name, status, completed_at, deadline_at, visibility, assigned_to, phase_id')
        .in('phase_id', phases.map(phase => phase.id))
        .order('order_index', { ascending: true })
      if (error) {
        console.error('GET calendar activities error:', error)
        return NextResponse.json({ error: 'Failed to load calendar' }, { status: 500 })
      }
      activities = data ?? []
    }

    const projects = (projectsRes.data ?? []) as any[]
    const requests = (requestsRes.data ?? []) as any[]
    const projectById = new Map(projects.map(project => [project.id, project]))

    // Consultantul general al proiectului contează ca responsabil doar dacă e
    // membru — aceeași condiție pe care o pune și publicarea (#70).
    const memberKeys = new Set(
      (membersRes.data ?? []).map((row: any) => `${row.project_id}:${row.consultant_id}`)
    )
    const generalOwnerOf = (project: any): string | null => {
      const candidate = project?.general_consultant_id ?? null
      if (!candidate) return null
      return memberKeys.has(`${project.id}:${candidate}`) ? candidate : null
    }

    // ── Nume de responsabili, dintr-o singură interogare ──────────────────────
    const ownerIds = new Set<string>()
    for (const activity of activities) if (activity.assigned_to) ownerIds.add(activity.assigned_to)
    for (const req of requests) {
      const own = req.assigned_to ?? one<any>(req.activity)?.assigned_to ?? null
      if (own) ownerIds.add(own)
      if (!req.activity_id) {
        const general = generalOwnerOf(projectById.get(req.project_id))
        if (general) ownerIds.add(general)
      }
    }

    const ownerById = new Map<string, { full_name: string | null; email: string | null }>()
    if (ownerIds.size > 0) {
      const { data: owners, error: ownersError } = await admin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', [...ownerIds])
      if (ownersError) {
        console.error('GET calendar owners error:', ownersError)
        return NextResponse.json({ error: 'Failed to load calendar' }, { status: 500 })
      }
      for (const owner of owners ?? []) ownerById.set(owner.id, owner)
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
      // Responsabilul cererii, cu revenire la activitatea-părinte și, pentru
      // cererile generale, la consultantul de proiect (#70).
      const ownerId = req.assigned_to
        ?? activity?.assigned_to
        ?? (activity ? null : generalOwnerOf(project))
        ?? null

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
