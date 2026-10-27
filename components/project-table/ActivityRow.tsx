'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ProjectActivity } from '@/components/ProjectPhasesSidebar'
import PublishStatusControl from '@/components/PublishStatusControl'
import InlineInput from '@/components/InlineInput'
import { bandVar } from '@/lib/signage'
import { progressLabel, type Progress } from '@/lib/completion'
import type { ActivityStatus } from '@/lib/activity-status'
import { AssigneeCell, CELL, DeadlineCell, ProgressCell, StatusCell, type Member } from './cells'
import type { ActivityColumns } from './TableGroup'

/**
 * Un rând al tabelului: o activitate, cu celulele ei. Cererile de documente
 * sunt sub-rândurile, ca subitemii din monday: se deschid cu săgeata (sau cu
 * un clic oriunde pe rând) și stau sub el, indentate, pe o linie în culoarea
 * fazei.
 *
 * Rândul nu e `role="button"`: înăuntru stau un `select`, un câmp de dată și
 * comutatorul de publicare, pe care semantica de buton le-ar ascunde. De la
 * tastatură se deschide din săgeată.
 */
export default function ActivityRow({
  activity,
  columns,
  band,
  status,
  completed,
  progress,
  open,
  onToggle,
  canAssign,
  projectMembers,
  onAssign,
  canPublish,
  showPublishedStatus,
  onPublish,
  publishBlockers,
  onSetDeadline,
  actions,
  renaming,
  renameLoading,
  onRenameSubmit,
  onRenameCancel,
  children,
}: {
  activity: ProjectActivity
  columns: ActivityColumns
  /** Banda fazei, pentru linia sub-rândurilor; `null` în afara unei faze. */
  band: number | null
  status: ActivityStatus
  /** Activitate finalizată (#109): termenul nu mai arde, numele se estompează. */
  completed: boolean
  /** Cererile activității, fără documentele trimise clientului. */
  progress: Progress
  open: boolean
  onToggle: () => void
  /** Cine poate publica poate și atribui — regula #70 cere un responsabil. */
  canAssign: boolean
  projectMembers: Member[]
  onAssign: (assignedTo: string | null) => void
  canPublish: boolean
  showPublishedStatus: boolean
  onPublish: () => void
  publishBlockers?: string[]
  onSetDeadline?: (value: string) => Promise<void> | void
  actions?: ReactNode
  renaming?: boolean
  renameLoading?: boolean
  onRenameSubmit?: (name: string) => void
  onRenameCancel?: () => void
  children: ReactNode
}) {
  return (
    <div id={`activity-${activity.id}`} className="scroll-mt-24 border-b border-rule/70 md:scroll-mt-48">
      <div
        onClick={onToggle}
        className="group/row grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 bg-paper-sunk/50 px-2 py-2.5 transition-colors duration-[120ms] hover:bg-paper-sunk/75 @min-[50rem]:grid-cols-(--cols) @min-[50rem]:gap-0 @min-[50rem]:p-0"
      >
        {/* Activitate */}
        <div className="flex min-w-0 items-start gap-1 @min-[50rem]:items-center @min-[50rem]:py-1.5 @min-[50rem]:pl-1 @min-[50rem]:pr-2">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onToggle() }}
            aria-expanded={open}
            aria-label={open ? `Restrânge activitatea ${activity.name}` : `Extinde activitatea ${activity.name}`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink pointer-fine:h-7 pointer-fine:w-7"
          >
            <ChevronRight className={`h-4 w-4 transition-transform duration-[160ms] ${open ? 'rotate-90' : ''}`} />
          </button>
          {renaming && onRenameSubmit && onRenameCancel ? (
            <div className="min-w-0 flex-1" onClick={e => e.stopPropagation()}>
              <InlineInput
                size="md"
                initialValue={activity.name}
                placeholder="Nume activitate..."
                loading={!!renameLoading}
                onConfirm={onRenameSubmit}
                onCancel={onRenameCancel}
              />
            </div>
          ) : (
            // Câte cereri are activitatea spune deja coloana „Documente”.
            <span className={`min-w-0 break-words pt-1.5 text-[13px] leading-snug @min-[50rem]:pt-0 ${completed ? 'text-ink-faint' : 'text-ink'}`}>
              {activity.name}
            </span>
          )}
        </div>

        {/* Pe fișă, celulele curg pe al doilea rând; pe coloane, își iau locul. */}
        <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-9 @min-[50rem]:contents">
          <div className={`${CELL} @min-[50rem]:justify-start`}>
            <AssigneeCell
              assignedTo={activity.assigned_to}
              assignedUser={activity.assigned_user}
              members={projectMembers}
              canAssign={canAssign}
              onAssign={onAssign}
              // Publică, activitatea nu poate rămâne fără responsabil (#70);
              // una publicată înainte de regulă, deja fără, nu e oprită.
              allowEmpty={activity.visibility !== 'published' || !activity.assigned_to}
            />
          </div>
          <div className={CELL}>
            <StatusCell tone={status.tone} label={status.label} />
          </div>
          <div className={CELL}>
            <ProgressCell done={progress.done} total={progress.total} sentence={progressLabel(progress, 'cerere', 'cereri')} />
          </div>
          <div className={CELL}>
            <DeadlineCell value={activity.deadline_at} done={completed} onSave={onSetDeadline} itemName={activity.name} />
          </div>
          {columns.visibility && (
            <div className={`${CELL} @min-[50rem]:px-2`}>
              <PublishStatusControl
                status={activity.visibility ?? 'draft'}
                canPublish={canPublish}
                showPublishedStatus={showPublishedStatus}
                onPublish={onPublish}
                blockers={publishBlockers}
                compact
                size="sm"
              />
            </div>
          )}
        </div>

        {/* „⋯” apare la trecerea mausului, cât meniul e deschis și la focus de
            la tastatură; pe touch rămâne la vedere. Nu `focus-within`: după un
            clic care închide meniul, focusul rămâne pe buton și îl ținea aprins
            (S-09). */}
        {columns.actions && (
          <div
            className={`col-start-2 row-start-1 flex items-start justify-center transition-opacity duration-[120ms] pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-open=true]]:opacity-100 @min-[50rem]:col-start-auto @min-[50rem]:row-start-auto ${CELL}`}
            onClick={e => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>

      {/* Linia de indentare nu îngustează grila cererilor față de cea a activității. */}
      {open && (
        <div
          className="relative mb-3 ml-5 border-l pl-2 @min-[50rem]:ml-0 @min-[50rem]:border-l-0 @min-[50rem]:pl-0"
          style={{ borderColor: band ? `color-mix(in srgb, ${bandVar(band)} 45%, transparent)` : 'var(--sg-rule)' }}
        >
          {children}
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-[1.3rem] hidden border-l border-inherit @min-[50rem]:block" />
        </div>
      )}
    </div>
  )
}
