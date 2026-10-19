import type { AppRole, Result } from './auth'
import { requireProfile } from './auth'
import { createSupabaseServiceClient } from './supabase'
import { chatTimestampMicroseconds } from '@/lib/chat-timestamp'

export type ProjectChatReadState = {
  project_id: string
  user_id: string
  last_read_at: string | null
}

type ProjectChatReadRow = {
  project_id: string
  last_read_at: string | null
}

type ProjectChatMessageRow = {
  id: string
  project_id: string
  created_at: string
}

type ProjectMembershipRow = { project_id: string }
type ProjectIdRow = { id: string }

const POSTGREST_PAGE_SIZE = 1000
const PROJECT_IDS_PER_MESSAGE_BATCH = 50

export { chatTimestampMicroseconds as projectChatTimestampMicroseconds }

async function forEachPage<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  consume: (rows: T[]) => void
) {
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + POSTGREST_PAGE_SIZE - 1)
    if (error) throw error

    const page = data ?? []
    consume(page)
    if (page.length < POSTGREST_PAGE_SIZE) return
  }
}

export type ProjectChatUnreadProject = {
  projectId: string
  unreadMessageCount: number
}

const getAccessibleProjectIdsForUnread = async (
  admin: ReturnType<typeof createSupabaseServiceClient>,
  role: AppRole,
  userId: string
): Promise<string[]> => {
  if (role === 'admin' || role === 'client') {
    const projectIds: string[] = []
    await forEachPage<ProjectIdRow>(
      (from, to) => {
        let query = admin.from('projects').select('id')
        if (role === 'client') query = query.eq('client_id', userId)
        return query.order('id').range(from, to)
      },
      (rows) => projectIds.push(...rows.map((row) => row.id))
    )
    return projectIds
  }

  const projectIds = new Set<string>()
  await forEachPage<ProjectMembershipRow>(
    (from, to) =>
      admin
        .from('project_members')
        .select('project_id')
        .eq('consultant_id', userId)
        .order('project_id')
        .range(from, to),
    (rows) => rows.forEach((row) => projectIds.add(row.project_id))
  )
  return [...projectIds]
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
    hasUnread: boolean
    unreadProjectCount: number
    unreadMessageCount: number
    unreadProjects: ProjectChatUnreadProject[]
  }>
> {
  const ctx = await requireProfile(request)
  if (!ctx.ok) return ctx

  const admin = createSupabaseServiceClient()

  let projectIds: string[]
  try {
    projectIds = await getAccessibleProjectIdsForUnread(admin, ctx.profile.role, ctx.user.id)
  } catch (error) {
    console.error('Failed to load accessible project chat projects:', {
      userId: ctx.user.id,
      role: ctx.profile.role,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to load project chat unread summary' }
  }

  if (projectIds.length === 0) {
    return {
      ok: true,
      hasUnread: false,
      unreadProjectCount: 0,
      unreadMessageCount: 0,
      unreadProjects: [],
    }
  }

  const accessibleProjectIds = new Set(projectIds)
  const lastReadMap = new Map<string, string | null>()
  try {
    await forEachPage<ProjectChatReadRow>(
      (from, to) =>
        admin
          .from('project_chat_reads')
          .select('project_id, last_read_at')
          .eq('user_id', ctx.user.id)
          .order('project_id')
          .range(from, to),
      (rows) => {
        for (const row of rows) {
          if (accessibleProjectIds.has(row.project_id)) {
            lastReadMap.set(row.project_id, row.last_read_at)
          }
        }
      }
    )
  } catch (error) {
    console.error('Failed to load project chat read rows:', {
      userId: ctx.user.id,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to load project chat unread summary' }
  }

  const projectsWithReadState = projectIds.filter((id) => !!lastReadMap.get(id))
  const projectsWithoutReadState = projectIds.filter((id) => !lastReadMap.get(id))
  const unreadMessageCountByProject = new Map<string, number>()
  let unreadMessageCount = 0

  try {
    const countMessages = async (projectBatch: string[], earliestLastReadAt?: string) => {
      await forEachPage<ProjectChatMessageRow>(
        (from, to) => {
          let query = admin
            .from('project_chat_messages')
            .select('id, project_id, created_at')
            .in('project_id', projectBatch)
            .neq('created_by', ctx.user.id)
            .is('deleted_at', null)

          if (earliestLastReadAt) query = query.gt('created_at', earliestLastReadAt)

          return query
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        },
        (messages) => {
          for (const message of messages) {
            const lastReadAt = lastReadMap.get(message.project_id)
            if (
              lastReadAt &&
              chatTimestampMicroseconds(message.created_at) <=
                chatTimestampMicroseconds(lastReadAt)
            ) continue

            unreadMessageCountByProject.set(
              message.project_id,
              (unreadMessageCountByProject.get(message.project_id) ?? 0) + 1
            )
            unreadMessageCount += 1
          }
        }
      )
    }

    for (const [ids, hasReadState] of [
      [projectsWithReadState, true],
      [projectsWithoutReadState, false],
    ] as const) {
      for (let from = 0; from < ids.length; from += PROJECT_IDS_PER_MESSAGE_BATCH) {
        const projectBatch = ids.slice(from, from + PROJECT_IDS_PER_MESSAGE_BATCH)
        if (hasReadState) {
          const earliestLastReadAt = projectBatch
            .map((id) => lastReadMap.get(id)!)
            .reduce((earliest, value) =>
              chatTimestampMicroseconds(value) <
              chatTimestampMicroseconds(earliest)
                ? value
                : earliest
            )
          await countMessages(projectBatch, earliestLastReadAt)
        } else {
          await countMessages(projectBatch)
        }
      }
    }
  } catch (error) {
    console.error('Failed to load project chat unread messages:', {
      userId: ctx.user.id,
      projectIds,
      error,
    })
    return { ok: false, status: 500, error: 'Failed to load project chat unread summary' }
  }

  const unreadProjects = projectIds.flatMap((projectId) => {
    const projectUnreadMessageCount = unreadMessageCountByProject.get(projectId) ?? 0
    return projectUnreadMessageCount > 0
      ? [{ projectId, unreadMessageCount: projectUnreadMessageCount }]
      : []
  })

  return {
    ok: true,
    hasUnread: unreadProjects.length > 0,
    unreadProjectCount: unreadProjects.length,
    unreadMessageCount,
    unreadProjects,
  }
}
