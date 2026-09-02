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
  /** Cine poate publica poate și atribui — regula #70 cere un responsabil */
  canAssign: boolean
  projectMembers: Member[]
  onAssign: (assignedTo: string | null) => void
  visibility?: 'draft' | 'published'
  canPublish: boolean
  onPublish: () => void
  publishBlockers?: string[]
  onSetDeadline?: (value: string) => Promise<void> | void
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
  canAssign,
  projectMembers,
  onAssign,
  visibility,
  canPublish,
  onPublish,
  publishBlockers,
  onSetDeadline,
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
      className="border border-[var(--p-border)]/60 rounded-xl bg-[var(--p-surface)] overflow-hidden scroll-mt-24 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      {/* Rândul rămâne clicabil în întregime, dar nu mai e `role="button"`:
          înăuntru stau acum select-uri și câmpuri (vezi PublishStatusControl),
          pe care semantica de buton le-ar ascunde de cititoarele de ecran, iar
          Enter/Space le-ar fura. Deschiderea de la tastatură stă pe chevron. */}
      <div
        onClick={onOpenChange}
        className="grid grid-cols-[minmax(0,1fr)_auto] sm:flex sm:items-center gap-x-2.5 gap-y-2 px-3.5 py-3 cursor-pointer hover:bg-[var(--p-surface-2)] transition-colors"
      >
        <div className="min-w-0 flex flex-wrap items-center gap-2.5 text-left">
          <span className="basis-full sm:basis-auto text-sm font-semibold text-[var(--p-ink)] break-words">{activity.name}</span>
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
        </div>

        <button
          type="button"
          onClick={e => { e.stopPropagation(); onOpenChange() }}
          aria-expanded={open}
          aria-label={open ? `Restrânge activitatea ${activity.name}` : `Extinde activitatea ${activity.name}`}
          className="sm:order-last flex-shrink-0 rounded p-0.5 text-[var(--p-ink-faint)] hover:bg-[var(--p-surface-2)]"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </button>

        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:contents">
        {/* Vizibil și pe telefon: responsabilul e condiție de publicare (#70),
            iar selectul de aici e singurul loc din care se atribuie. */}
        <div className="flex items-center flex-shrink-0">
          {canAssign ? (
            <select
              value={activity.assigned_to ?? ''}
              onClick={e => e.stopPropagation()}
              onChange={e => onAssign(e.target.value || null)}
              aria-label="Atribuie consultant"
              className="font-sans text-xs font-medium text-[var(--p-accent)] border border-[var(--p-accent-soft)] rounded-md pl-2 pr-5 py-1 bg-[var(--p-accent-soft)] hover:opacity-80 cursor-pointer outline-none max-w-[10rem] truncate"
            >
              <option value="">Neasignată</option>
              {projectMembers.map(m => (
                <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
              ))}
            </select>
          ) : activity.assigned_to ? (
            <span className="inline-flex items-center gap-1.5 text-xs leading-none text-[var(--p-ink-soft)]" title={activity.assigned_user?.full_name || activity.assigned_user?.email}>
              <span className="w-5 h-5 rounded-full bg-[var(--p-accent-soft)] text-[var(--p-accent-ink)] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {initials(activity.assigned_user?.full_name, activity.assigned_user?.email)}
              </span>
              <span className="hidden md:inline truncate max-w-[8rem]">
                {activity.assigned_user?.full_name || activity.assigned_user?.email}
              </span>
            </span>
          ) : (
            <span className="text-xs leading-none text-[var(--p-ink-faint)] italic">Neasignată</span>
          )}
        </div>

        <div className="hidden sm:block flex-1" />

        {/* Controlul își oprește singur propagarea pe ramurile interactive;
            pe cea pasivă, clickul trebuie să ajungă la rând. */}
        <div className="flex-shrink-0">
          <PublishStatusControl
            status={visibility ?? 'draft'}
            canPublish={canPublish}
            showPublishedStatus={canPublish}
            onPublish={onPublish}
            blockers={publishBlockers}
            onSetDeadline={onSetDeadline}
            size="sm"
          />
        </div>
        </div>
      </div>
      <Collapsible.Content>
        <div className="border-t border-[var(--p-border)]">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
