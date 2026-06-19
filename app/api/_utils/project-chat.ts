import type { AppRole, Result } from './auth'
import { requireProfile } from './auth'
import { createSupabaseServiceClient } from './supabase'

export type ProjectChatReadState = {
  project_id: string
  user_id: string
  last_read_at: string | null
}

type ProjectChatReadRow = {
  project_id: string
  user_id?: string
  last_read_at: string | null
}

type ProjectChatMessageRow = {
  project_id: string
  created_at: string
  created_by: string
}

export type ProjectChatUnreadProject = {
  projectId: string
  unreadMessageCount: number
}

const getAccessibleProjectIdsForUnread = async (
  admin: ReturnType<typeof createSupabaseServiceClient>,
  role: AppRole,
  userId: string,
  candidateProjectIds: string[]
) => {
  if (candidateProjectIds.length === 0) return new Set<string>()

  if (role === 'admin') {
    return new Set(candidateProjectIds)
  }

  if (role === 'client') {
    const { data, error } = await admin
      .from('projects')
      .select('id')
      .in('id', candidateProjectIds)
      .eq('client_id', userId)

    if (error) throw error
    return new Set((data ?? []).map((row: { id: string }) => row.id))
  }

  const { data, error } = await admin
    .from('project_members')
    .select('project_id')
    .in('project_id', candidateProjectIds)
    .eq('consultant_id', userId)

  if (error) throw error
  return new Set((data ?? []).map((row: { project_id: string }) => row.project_id))
}

export async function getProjectChatReadStates(projectId: string): Promise<{
  readStates: ProjectChatReadState[]
}> {
  const admin = createSupabaseServiceClient()

  const { data, error } = await admin
    .from('project_chat_reads')
    .select('project_id, user_id, last_read_at')
    .eq('project_id', projectId)

  if (error) throw error

  return {
    readStates: (data ?? []).map((row: ProjectChatReadState) => ({
      project_id: row.project_id,
      user_id: row.user_id,
      last_read_at: row.last_read_at,
    })),
  }
}

export async function getProjectChatUnreadSummary(
  request: Request
): Promise<
  Result<{
    user: { id: string }
    profile: { id: string; role: AppRole; email?: string | null }
    hasUnread: boolean
    unreadProjectCount: number
    unreadMessageCount: number
    unreadProjects: ProjectChatUnreadProject[]
  }>
> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  const admin = createSupabaseServiceClient()

  const { data: readRows, error: readError } = await admin
    .from('project_chat_reads')
    .select('project_id, last_read_at')
    .eq('user_id', ctx.user.id)

  if (readError) {
    console.error('Failed to load project chat read rows:', {
      userId: ctx.user.id,
      error: readError,
    })
    return { ok: false, status: 500, error: 'Failed to load project chat unread summary' }
  }

  const allReads = (readRows ?? []) as ProjectChatReadRow[]
  const candidateProjectIds = allReads.map((row) => row.project_id)

  if (candidateProjectIds.length === 0) {
    return {
      ok: true,
      user: { id: ctx.user.id },
      profile: ctx.profile,
      hasUnread: false,
      unreadProjectCount: 0,
      unreadMessageCount: 0,
      unreadProjects: [],
    }
  }

  let accessibleProjectIds: Set<string>
  try {
    accessibleProjectIds = await getAccessibleProjectIdsForUnread(
      admin,
      ctx.profile.role,
      ctx.user.id,
      candidateProjectIds
    )
  } catch (error) {
    console.error('Failed to filter accessible project chat reads:', {
      userId: ctx.user.id,
      role: ctx.profile.role,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to load project chat unread summary' }
  }

  const accessibleReads = allReads.filter((row) => accessibleProjectIds.has(row.project_id))

  if (accessibleReads.length === 0) {
    return {
      ok: true,
      user: { id: ctx.user.id },
      profile: ctx.profile,
      hasUnread: false,
      unreadProjectCount: 0,
      unreadMessageCount: 0,
      unreadProjects: [],
    }
  }

  const lastReadMap = new Map<string, string | null>()
  for (const row of accessibleReads) {
    lastReadMap.set(row.project_id, row.last_read_at)
  }

  const readTimes = accessibleReads
    .map((row) => row.last_read_at)
    .filter((value): value is string => !!value)

  const earliestLastReadAt =
    readTimes.length === accessibleReads.length
      ? readTimes.reduce((earliest, value) =>
          new Date(value).getTime() < new Date(earliest).getTime() ? value : earliest
        )
      : null

  let messagesQuery = admin
    .from('project_chat_messages')
    .select('project_id, created_at, created_by')
    .in('project_id', accessibleReads.map((row) => row.project_id))
    .neq('created_by', ctx.user.id)
    .is('deleted_at', null)

  if (earliestLastReadAt) {
    messagesQuery = messagesQuery.gt('created_at', earliestLastReadAt)
  }

  const { data: messages, error: messagesError } = await messagesQuery.order('created_at', {
    ascending: false,
  })

  if (messagesError) {
    console.error('Failed to load project chat unread messages:', {
      userId: ctx.user.id,
      projectIds: accessibleReads.map((row) => row.project_id),
      error: messagesError,
    })
    return { ok: false, status: 500, error: 'Failed to load project chat unread summary' }
  }

  const unreadMessageCountByProject = new Map<string, number>()
  let unreadMessageCount = 0

  for (const message of (messages ?? []) as ProjectChatMessageRow[]) {
    const lastReadAt = lastReadMap.get(message.project_id)

    if (
      !lastReadAt ||
      new Date(message.created_at).getTime() > new Date(lastReadAt).getTime()
    ) {
      unreadMessageCountByProject.set(
        message.project_id,
        (unreadMessageCountByProject.get(message.project_id) ?? 0) + 1
      )
      unreadMessageCount += 1
    }
  }

  const unreadProjects = [...unreadMessageCountByProject.entries()].map(
    ([projectId, projectUnreadMessageCount]) => ({
      projectId,
      unreadMessageCount: projectUnreadMessageCount,
    })
  )

  return {
    ok: true,
    user: { id: ctx.user.id },
    profile: ctx.profile,
    hasUnread: unreadProjects.length > 0,
    unreadProjectCount: unreadProjects.length,
    unreadMessageCount,
    unreadProjects,
  }
}
