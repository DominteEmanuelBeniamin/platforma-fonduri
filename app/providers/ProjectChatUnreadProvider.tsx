'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/app/providers/AuthProvider'

export const PROJECT_CHAT_UNREAD_REFRESH_EVENT = 'project-chat-unread:refresh'
export const PROJECT_CHAT_PROJECT_READ_EVENT = 'project-chat-unread:project-read'

export type ProjectChatUnreadProject = {
  projectId: string
  unreadMessageCount: number
}

type UnreadSummaryResponse = {
  hasUnread?: boolean
  unreadProjectCount?: number
  unreadMessageCount?: number
  unreadProjects?: ProjectChatUnreadProject[]
  error?: string
}

type ProjectChatUnreadState = {
  hasUnread: boolean
  unreadProjectCount: number
  unreadMessageCount: number
  unreadProjects: ProjectChatUnreadProject[]
}

type ProjectChatUnreadContextValue = ProjectChatUnreadState & {
  active: boolean
  refresh: () => Promise<void>
}

const emptyState: ProjectChatUnreadState = {
  hasUnread: false,
  unreadProjectCount: 0,
  unreadMessageCount: 0,
  unreadProjects: [],
}

const ProjectChatUnreadContext = createContext<ProjectChatUnreadContextValue | null>(null)

export function emitProjectChatUnreadRefresh() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PROJECT_CHAT_UNREAD_REFRESH_EVENT))
}

export function emitProjectChatProjectRead(projectId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(PROJECT_CHAT_PROJECT_READ_EVENT, {
      detail: { projectId },
    })
  )
}

export function ProjectChatUnreadProvider({ children }: { children: ReactNode }) {
  const { apiFetch, loading: authLoading, token, userId } = useAuth()
  const [state, setState] = useState<ProjectChatUnreadState>(emptyState)
  const inFlightRefreshRef = useRef<Promise<void> | null>(null)
  const queuedRefreshRef = useRef(false)
  const active = !authLoading && !!token && !!userId

  const applyProjectReadOptimistically = useCallback((projectId: string) => {
    setState((prev) => {
      const currentProject = prev.unreadProjects.find((item) => item.projectId === projectId)
      if (!currentProject) return prev

      const unreadProjects = prev.unreadProjects.filter((item) => item.projectId !== projectId)
      const unreadMessageCount = Math.max(
        0,
        prev.unreadMessageCount - currentProject.unreadMessageCount
      )

      return {
        hasUnread: unreadProjects.length > 0,
        unreadProjectCount: unreadProjects.length,
        unreadMessageCount,
        unreadProjects,
      }
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!active) return

    if (inFlightRefreshRef.current) {
      queuedRefreshRef.current = true
      await inFlightRefreshRef.current
      return
    }

    const runRefresh = async () => {
      try {
        const res = await apiFetch('/api/projects/chat/unread', { method: 'GET' })
        const json = (await res.json().catch(() => null)) as UnreadSummaryResponse | null

        if (!res.ok) return

        const projectCount = json?.unreadProjectCount ?? 0
        const messageCount = json?.unreadMessageCount ?? 0
        const unreadProjects = json?.unreadProjects ?? []

        setState({
          hasUnread: json?.hasUnread ?? projectCount > 0,
          unreadProjectCount: projectCount,
          unreadMessageCount: messageCount,
          unreadProjects,
        })
      } catch {
        // Keep previous state if the lightweight indicator refresh fails.
      } finally {
        inFlightRefreshRef.current = null
      }
    }

    do {
      queuedRefreshRef.current = false
      inFlightRefreshRef.current = runRefresh()
      await inFlightRefreshRef.current
    } while (queuedRefreshRef.current)
  }, [active, apiFetch])

  useEffect(() => {
    if (active) return
    inFlightRefreshRef.current = null
    queuedRefreshRef.current = false
    setState(emptyState)
  }, [active])

  useEffect(() => {
    if (!active || !userId) return

    const initialRefresh = window.setTimeout(() => {
      void refresh()
    }, 0)

    const interval = window.setInterval(() => {
      void refresh()
    }, 15000)

    const onRefresh = () => {
      void refresh()
    }

    const onProjectRead = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectId?: string }>
      const projectId = customEvent.detail?.projectId
      if (projectId) {
        applyProjectReadOptimistically(projectId)
      }
      void refresh()
    }

    window.addEventListener(PROJECT_CHAT_UNREAD_REFRESH_EVENT, onRefresh)
    window.addEventListener(PROJECT_CHAT_PROJECT_READ_EVENT, onProjectRead as EventListener)

    const channel = supabase
      .channel(`project-chat-unread-global-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_chat_messages',
        },
        () => {
          void refresh()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_chat_reads',
        },
        () => {
          void refresh()
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void refresh()
        }
      })

    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
      window.removeEventListener(PROJECT_CHAT_UNREAD_REFRESH_EVENT, onRefresh)
      window.removeEventListener(PROJECT_CHAT_PROJECT_READ_EVENT, onProjectRead as EventListener)
      supabase.removeChannel(channel)
    }
  }, [active, applyProjectReadOptimistically, refresh, userId])

  const value = useMemo<ProjectChatUnreadContextValue>(
    () => ({
      active,
      refresh,
      ...state,
    }),
    [active, refresh, state]
  )

  return (
    <ProjectChatUnreadContext.Provider value={value}>
      {children}
    </ProjectChatUnreadContext.Provider>
  )
}

export function useProjectChatUnread(enabled = true) {
  const value = useContext(ProjectChatUnreadContext)
  if (!value) {
    throw new Error('useProjectChatUnread must be used within ProjectChatUnreadProvider')
  }

  const active = enabled && value.active

  return {
    hasUnread: active ? value.hasUnread : false,
    unreadProjectCount: active ? value.unreadProjectCount : 0,
    unreadMessageCount: active ? value.unreadMessageCount : 0,
    unreadProjects: active ? value.unreadProjects : [],
    refresh: value.refresh,
  }
}
