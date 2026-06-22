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

export function ProjectChatUnreadProvider({ children }: { children: ReactNode }) {
  const { apiFetch, loading: authLoading, token, userId } = useAuth()
  const [state, setState] = useState<ProjectChatUnreadState>(emptyState)
  const inFlightRefreshRef = useRef<Promise<void> | null>(null)
  const active = !authLoading && !!token && !!userId

  const refresh = useCallback(async () => {
    if (!active) return

    if (inFlightRefreshRef.current) {
      await inFlightRefreshRef.current
      return
    }

    inFlightRefreshRef.current = (async () => {
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
    })()

    await inFlightRefreshRef.current
  }, [active, apiFetch])

  useEffect(() => {
    if (active) return
    inFlightRefreshRef.current = null
    setState(emptyState)
  }, [active])

  useEffect(() => {
    if (!active || !userId) return

    void refresh()

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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [active, refresh, userId])

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
