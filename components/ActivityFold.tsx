'use client'

import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronRight, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProjectActivity } from '@/components/ProjectPhasesSidebar'
import PublishStatusControl from '@/components/PublishStatusControl'

interface Member {
  id: string
  full_name: string | null
  email: string
}

interface ActivityFoldProps {
  activity: ProjectActivity
  requestCount: number
  open: boolean
  onOpenChange: () => void
  highlighted?: boolean
  isAdmin: boolean
  projectMembers: Member[]
  onAssign: (assignedTo: string | null) => void
  /** Machetă #53 — status „În pregătire”/„Public”, doar vizual. */
  mockStatus: 'draft' | 'public'
  canPublish: boolean
  onTogglePublish: () => void
  children: ReactNode
}

function initials(name: string | null | undefined, email: string | undefined) {
  const src = (name || email || '?').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

export default function ActivityFold({
  activity,
  requestCount,
  open,
  onOpenChange,
  highlighted,
  isAdmin,
  projectMembers,
  onAssign,
  mockStatus,
  canPublish,
  onTogglePublish,
  children,
}: ActivityFoldProps) {
  const deadline = activity.deadline_at ? new Date(activity.deadline_at) : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  deadline?.setHours(0, 0, 0, 0)
  const isOverdue = !!deadline && deadline < today
  const deadlineLabel = deadline
    ? deadline.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })
    : null

  return (
    <Collapsible.Root
      id={`activity-${activity.id}`}
      open={open}
      onOpenChange={onOpenChange}
      className={`border rounded-xl bg-[var(--p-surface)] overflow-hidden scroll-mt-24 transition-all duration-500 ${
        highlighted
          ? 'ring-2 ring-[var(--p-accent)] ring-offset-2 ring-offset-[var(--p-bg)] border-[var(--p-accent-soft)]'
          : 'border-[var(--p-border)]/60 shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
      }`}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <Collapsible.Trigger asChild>
          <button className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
            <span className="text-sm font-semibold text-[var(--p-ink)] truncate">{activity.name}</span>
            {deadlineLabel && (
              <span
                className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 ${
                  isOverdue ? 'bg-[var(--p-danger-soft)] text-[var(--p-danger)]' : 'bg-[var(--p-warning-soft)] text-[var(--p-warning)]'
                }`}
              >
                <Clock className="w-2.5 h-2.5" />
                {deadlineLabel}
              </span>
            )}
            {requestCount > 0 && (
              <span className="hidden sm:inline text-[11px] font-medium text-[var(--p-ink-faint)] flex-shrink-0">
                {requestCount} cerer{requestCount === 1 ? 'e' : 'i'}
              </span>
            )}
            <ChevronRight
              className={`w-3.5 h-3.5 text-[var(--p-ink-faint)] flex-shrink-0 ml-auto transition-transform duration-200 ${
                open ? 'rotate-90' : ''
              }`}
            />
          </button>
        </Collapsible.Trigger>

        <PublishStatusControl status={mockStatus} canPublish={canPublish} onToggle={onTogglePublish} size="sm" />

        <div onClick={e => e.stopPropagation()} className="flex-shrink-0">
          {isAdmin ? (
            <div className="inline-flex items-center text-[var(--p-accent)]">
              <select
                value={activity.assigned_to ?? ''}
                onChange={e => onAssign(e.target.value || null)}
                aria-label="Atribuie consultant"
                className="text-[11px] font-semibold text-[var(--p-accent)] border border-[var(--p-accent-soft)] rounded-md pl-1.5 pr-4 py-1 bg-[var(--p-accent-soft)] hover:opacity-80 cursor-pointer outline-none max-w-[9rem] truncate"
              >
                <option value="">Neasignată</option>
                {projectMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                ))}
              </select>
            </div>
          ) : activity.assigned_to ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--p-ink-soft)]" title={activity.assigned_user?.full_name || activity.assigned_user?.email}>
              <span className="w-5 h-5 rounded-full bg-[var(--p-accent-soft)] text-[var(--p-accent-ink)] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {initials(activity.assigned_user?.full_name, activity.assigned_user?.email)}
              </span>
              <span className="hidden md:inline truncate max-w-[8rem]">
                {activity.assigned_user?.full_name || activity.assigned_user?.email}
              </span>
            </span>
          ) : (
            <span className="text-[11px] text-[var(--p-ink-faint)] italic">Neasignată</span>
          )}
        </div>
      </div>
      <Collapsible.Content>
        <div className="border-t border-[var(--p-border)]">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
