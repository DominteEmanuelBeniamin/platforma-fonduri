/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { userLifecycleConflict } from '@/app/api/_utils/user-lifecycle'
import { isActivityDone, isProjectActive } from '@/lib/calendar'
import { isUuid } from '@/lib/notification-utils'

const PAGE_SIZE = 1000
const IN_FILTER_SIZE = 500

async function selectAll(buildQuery: () => any, orderColumn = 'id') {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().order(orderColumn).range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

async function selectIn(admin: any, table: string, columns: string, column: string, values: string[], orderColumn = 'id') {
  const rows: any[] = []
  const uniqueValues = [...new Set(values)]
  for (let index = 0; index < uniqueValues.length; index += IN_FILTER_SIZE) {
    const batch = uniqueValues.slice(index, index + IN_FILTER_SIZE)
    rows.push(...await selectAll(() => admin.from(table).select(columns).in(column, batch), orderColumn))
  }
  return rows
}

function blockersAreValid(value: unknown): value is Array<{ kind: string; count: number }> {
  return Array.isArray(value) && value.every(item =>
    item && typeof item.kind === 'string'
    && Number.isInteger(item.count) && item.count >= 0
  )
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await params
    if (!isUuid(userId)) {
      return NextResponse.json({ error: 'User ID trebuie să fie UUID valid' }, { status: 400 })
    }

    const actor = await requireAdmin(request)
    if (!actor.ok) return guardToResponse(actor)

    const admin = createSupabaseServiceClient()
    const [
      targetResult,
      generalProjects,
      targetMemberships,
      directlyAssignedActivities,
      directlyAssignedRequests,
      blockerResult,
    ] = await Promise.all([
      admin.from('profiles').select('id, role, consultant_level').eq('id', userId).maybeSingle(),
      selectAll(() => admin.from('projects')
        .select('id, lifecycle_status, client_id, general_consultant_id')
        .or('client_id.eq.' + userId + ',general_consultant_id.eq.' + userId)),
      selectAll(() => admin.from('project_members').select('project_id').eq('consultant_id', userId), 'project_id'),
      selectAll(() => admin.from('project_activities').select('id, phase_id, assigned_to, status, completed_at').eq('assigned_to', userId)),
      selectAll(() => admin.from('document_requirements')
        .select('id, project_id, activity_id, assigned_to, status, deleted_at')
        .eq('assigned_to', userId)),
      admin.rpc('user_account_blockers', { p_target_id: userId }),
    ])

    if (targetResult.error) throw targetResult.error
    if (!targetResult.data) return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 })
    if (blockerResult.error) throw blockerResult.error
    if (!blockersAreValid(blockerResult.data)) throw new Error('Invalid lifecycle blocker result')

    const generalProjectIds = generalProjects
      .filter(project => project.general_consultant_id === userId)
      .map(project => project.id)
    const directPhaseIds = directlyAssignedActivities.map(activity => activity.phase_id).filter(Boolean)
    const generalPhases = await selectIn(admin, 'project_phases', 'id, project_id', 'project_id', generalProjectIds)
    const directPhases = await selectIn(admin, 'project_phases', 'id, project_id', 'id', directPhaseIds)
    const phaseById = new Map([...generalPhases, ...directPhases].map(phase => [phase.id, phase]))
    const relevantPhaseIds = [...phaseById.keys()]
    const activitiesInRelevantPhases = await selectIn(
      admin,
      'project_activities',
      'id, phase_id, assigned_to, status, completed_at',
      'phase_id',
      relevantPhaseIds,
    )
    const activityById = new Map<string, any>()
    for (const activity of [...directlyAssignedActivities, ...activitiesInRelevantPhases]) {
      activityById.set(activity.id, activity)
    }

    const inheritedRequests = await selectIn(
      admin,
      'document_requirements',
      'id, project_id, activity_id, assigned_to, status, deleted_at',
      'activity_id',
      [...activityById.keys()],
    )
    const generalRequests = await selectIn(
      admin,
      'document_requirements',
      'id, project_id, activity_id, assigned_to, status, deleted_at',
      'project_id',
      generalProjectIds,
    )
    const requestById = new Map<string, any>()
    for (const row of [...directlyAssignedRequests, ...inheritedRequests, ...generalRequests.filter(row => !row.activity_id)]) requestById.set(row.id, row)

    const projectIds = new Set<string>([
      ...generalProjects.map(project => project.id),
      ...targetMemberships.map(row => row.project_id),
      ...directlyAssignedRequests.map(row => row.project_id).filter(Boolean),
      ...[...phaseById.values()].map(phase => phase.project_id),
    ])
    const projects = await selectIn(
      admin,
      'projects',
      'id, lifecycle_status, client_id, general_consultant_id',
      'id',
      [...projectIds],
    )
    const projectById = new Map(projects.map(project => [project.id, project]))
    const projectsByActivity = new Map<string, any>()
    for (const activity of activityById.values()) {
      const phase = phaseById.get(activity.phase_id)
      if (phase) projectsByActivity.set(activity.id, projectById.get(phase.project_id))
    }

    const activities = [...activityById.values()].filter(activity => {
      const project = projectsByActivity.get(activity.id)
      const responsibleId = activity.assigned_to || project?.general_consultant_id
      return responsibleId === userId && !isActivityDone(activity)
    }).length

    const documentRequests = [...requestById.values()].filter(row => {
      if (row.deleted_at || row.status === 'approved') return false
      const activity = row.activity_id ? activityById.get(row.activity_id) : null
      const project = projectById.get(row.project_id) ?? (activity ? projectsByActivity.get(activity.id) : null)
      const responsibleId = row.assigned_to || activity?.assigned_to || project?.general_consultant_id
      return responsibleId === userId
    }).length

    const impactedProjects = [...projectById.values()]
    const activeProjects = impactedProjects.filter(isProjectActive).length
    const completedProjects = impactedProjects.length - activeProjects
    const generalConsultantProjects = new Set(
      impactedProjects.filter(project => project.general_consultant_id === userId).map(project => project.id),
    ).size

    const targetIsSenior = targetResult.data.role === 'consultant'
      && targetResult.data.consultant_level === 'senior'
    const targetMemberProjectIds = targetIsSenior
      ? [...new Set(targetMemberships.map(row => row.project_id))]
      : []
    let projectsWithoutActiveSenior = 0
    if (targetMemberProjectIds.length > 0) {
      const peerMemberships = await selectIn(admin, 'project_members', 'id, project_id, consultant_id', 'project_id', targetMemberProjectIds, 'id')
      const peerIds = [...new Set(peerMemberships.map(row => row.consultant_id).filter((id: unknown): id is string => typeof id === 'string'))]
      const peerProfiles = await selectIn(admin, 'profiles', 'id, role, consultant_level, is_active', 'id', peerIds)
      const peerById = new Map(peerProfiles.map(profile => [profile.id, profile]))
      const seniorByProject = new Map<string, boolean>()
      for (const membership of peerMemberships) {
        if (membership.consultant_id === userId) continue
        const profile = peerById.get(membership.consultant_id)
        if (profile?.role === 'consultant' && profile.consultant_level === 'senior' && profile.is_active === true) {
          seniorByProject.set(membership.project_id, true)
        }
      }
      projectsWithoutActiveSenior = targetMemberProjectIds.filter(projectId => {
        const project = projectById.get(projectId)
        return project && isProjectActive(project) && seniorByProject.get(projectId) !== true
      }).length
    }

    return NextResponse.json({
      impact: {
        activities,
        documentRequests,
        activeProjects,
        completedProjects,
        generalConsultantProjects,
        projectsWithoutActiveSenior,
      },
      blockers: blockerResult.data,
    })
  } catch (error) {
    if (error && typeof error === 'object') {
      const conflict = userLifecycleConflict(error)
      if (conflict) return NextResponse.json(conflict.body, { status: conflict.status })
    }
    console.error('GET user lifecycle impact failed:', error)
    return NextResponse.json({ error: 'Nu am putut încărca impactul contului.' }, { status: 500 })
  }
}
