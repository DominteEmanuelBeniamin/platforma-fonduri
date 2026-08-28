import { NextResponse } from 'next/server'
import { requireProfile, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { isClientVisibleActivity, isClientVisibleDocument, isClientVisiblePhase } from '@/lib/client-visibility'
import { GENERAL_PHASE_ID } from '@/lib/calendar'
import { isUuid } from '@/lib/notification-utils'

type RouteParams = { params: Promise<{ id: string }> }

function notFound() {
  return NextResponse.json({ error: 'Notification target not found' }, { status: 404 })
}

export async function GET(request: Request, { params }: RouteParams) {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Notification id must be a UUID' }, { status: 400 })

  // RLS is the first access check: a notification lost through membership/client
  // changes must not be resolved through the service client below.
  const userClient = createSupabaseServerClient(request)
  const { data: notification, error: notificationError } = await userClient
    .from('notifications')
    .select('id, project_id, entity_type, entity_id')
    .eq('id', id)
    .maybeSingle()

  if (notificationError) {
    console.error('GET /api/notifications/[id]/target notification error:', notificationError)
    return NextResponse.json({ error: 'Failed to load notification' }, { status: 500 })
  }
  if (!notification) return notFound()

  const access = await requireProjectAccess(request, notification.project_id)
  if (!access.ok) return notFound()

  try {
    const admin = createSupabaseServiceClient()
    const projectId = notification.project_id as string
    const entityId = notification.entity_id as string

    if (notification.entity_type === 'project') {
      const { data: project, error } = await admin
        .from('projects')
        .select('id')
        .eq('id', entityId)
        .maybeSingle()
      if (error) throw error
      return project?.id === projectId ? NextResponse.json({ href: `/projects/${projectId}` }) : notFound()
    }

    if (notification.entity_type === 'phase') {
      const { data: phase, error } = await admin
        .from('project_phases')
        .select('id, project_id, visibility')
        .eq('id', entityId)
        .maybeSingle()
      if (error) throw error
      if (!phase || phase.project_id !== projectId) return notFound()
      if (access.profile.role === 'client' && !isClientVisiblePhase(phase)) return notFound()
      return NextResponse.json({ href: `/projects/${projectId}?phase=${phase.id}` })
    }

    if (notification.entity_type === 'activity') {
      const { data: activity, error } = await admin
        .from('project_activities')
        .select('id, phase_id, phase:phase_id(id, project_id, visibility), visibility')
        .eq('id', entityId)
        .maybeSingle()
      if (error) throw error
      const phase = Array.isArray(activity?.phase) ? activity.phase[0] : activity?.phase
      if (!activity || !phase || phase.project_id !== projectId) return notFound()
      if (
        access.profile.role === 'client' &&
        !isClientVisibleActivity({ ...activity, phase })
      ) return notFound()
      return NextResponse.json({
        href: `/projects/${projectId}?phase=${phase.id}&activity=${activity.id}#activity-${activity.id}`,
      })
    }

    if (notification.entity_type === 'document_request') {
      const { data: requestRow, error } = await admin
        .from('document_requirements')
        .select('id, project_id, activity_id, deleted_at, visibility, activity:activity_id(id, phase_id, visibility, phase:phase_id(id, project_id, visibility))')
        .eq('id', entityId)
        .maybeSingle()
      if (error) throw error
      if (!requestRow || requestRow.project_id !== projectId || requestRow.deleted_at) return notFound()

      if (access.profile.role === 'client' && !isClientVisibleDocument(requestRow)) {
        return notFound()
      }

      const activity = Array.isArray(requestRow.activity) ? requestRow.activity[0] : requestRow.activity
      if (activity) {
        const phase = Array.isArray(activity.phase) ? activity.phase[0] : activity.phase
        if (!phase || phase.project_id !== projectId) return notFound()
      }
      if (requestRow.activity_id && !activity) return notFound()
      const phase = Array.isArray(activity?.phase) ? activity.phase[0] : activity?.phase
      const query = new URLSearchParams({
        phase: phase?.id ?? GENERAL_PHASE_ID,
        document: requestRow.id,
      })
      if (activity?.id) query.set('activity', activity.id)
      const hash = activity?.id ? `#activity-${activity.id}` : '#general-requests'
      return NextResponse.json({ href: `/projects/${projectId}?${query.toString()}${hash}` })
    }

    return notFound()
  } catch (error) {
    console.error('GET /api/notifications/[id]/target entity error:', error)
    return NextResponse.json({ error: 'Failed to resolve notification target' }, { status: 500 })
  }
}
