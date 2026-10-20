'use client'

import { AlertTriangle, ChevronRight, Clock, FileText, ListChecks } from 'lucide-react'
import { TONE } from '@/lib/signage'

export interface PendingUpload {
  id: string
  name: string
  status: string
  deadline_at: string | null
  activity_id: string | null
  activity_name: string | null
  phase_id: string | null
  phase_name: string | null
}

interface ActionNeededPanelProps {
  items: PendingUpload[]
  waitingItems?: PendingUpload[]
  isClient: boolean
  /** Proiect încheiat (#109, D5): nimic nu mai e de făcut, iar starea goală spune de ce. */
  projectClosed?: boolean
  onJump: (phaseId: string | null, activityId: string | null, requestId?: string) => void
}

export default function ActionNeededPanel({ items, waitingItems = [], isClient, projectClosed = false, onJump }: ActionNeededPanelProps) {
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)

  const isOverdue = (r: PendingUpload) => {
    if (!r.deadline_at) return false
    const d = new Date(r.deadline_at)
    d.setHours(0, 0, 0, 0)
    return d < todayMidnight
  }

  const overdueCount = items.filter(isOverdue).length
  const waitingOverdueCount = waitingItems.filter(isOverdue).length
  const renderRows = (rows: PendingUpload[], waiting = false) => rows.map(req => {
    const deadline = req.deadline_at ? new Date(req.deadline_at) : null
    deadline?.setHours(0, 0, 0, 0)
    const overdue = deadline && deadline < todayMidnight
    const isRejected = !waiting && req.status === 'rejected'
    const danger = overdue || isRejected
    const statusTone = TONE[danger ? 'danger' : waiting || isClient ? 'pending' : 'review']
    const pill = waiting
      ? (overdue ? 'Termen depășit' : 'La client')
      : (isRejected ? 'Respins' : isClient ? 'De încărcat' : 'De revizuit')

    return (
      <button data-tooltip="Mergi la cererea din proiect"
        key={req.id}
        onClick={() => onJump(req.phase_id, req.activity_id, req.id)}
        className="group w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-paper-sunk"
      >
        <div className="w-7 h-7 rounded-[var(--radius-plate)] flex items-center justify-center flex-shrink-0" style={{ background: statusTone.bg, color: statusTone.fg }}>
          {danger
            ? <AlertTriangle className="w-3.5 h-3.5" />
            : <FileText className="w-3.5 h-3.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate leading-snug ${overdue ? 'text-[var(--p-danger)]' : 'text-[var(--p-ink)]'}`}>
            {req.name}
          </p>
          <p className="text-[11px] text-[var(--p-ink-faint)] truncate mt-0.5">
            {req.phase_name
              ? <>{req.phase_name}{req.activity_name && <span className="text-[var(--p-border-strong)]"> / {req.activity_name}</span>}</>
              : 'Cereri generale'}
          </p>
        </div>
        {deadline && (
          <div className={`hidden sm:flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-plate)] flex-shrink-0 tabular-nums ${
            overdue ? 'bg-[var(--p-danger-soft)] text-[var(--p-danger)]' : 'bg-[var(--p-surface)] text-[var(--p-ink-soft)] border border-[var(--p-border)]'
          }`}>
            <Clock className="w-2.5 h-2.5" />
            {deadline.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
          </div>
        )}
        <span className="hidden md:inline-flex flex-shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-plate)]" style={{ background: statusTone.bg, color: statusTone.fg }}>
          {pill}
        </span>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-faint transition-colors group-hover:text-[var(--sg-accent)]" aria-hidden="true" />
      </button>
    )
  })

  if (items.length === 0 && waitingItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 sm:p-12">
        <div className="w-12 h-12 bg-[var(--p-success-soft)] rounded-[var(--radius-plate)] flex items-center justify-center mb-3">
          <ListChecks className="w-8 h-8 text-[var(--p-success)]" />
        </div>
        <h2 className="font-display text-lg font-semibold text-[var(--p-ink)] mb-1">Nimic de făcut</h2>
        <p className="text-sm text-[var(--p-ink-soft)] max-w-xs">
          {projectClosed
            ? 'Proiectul e încheiat, deci nu mai are nimic de făcut. Cererile lui rămân de consultat în „Faze & Activități”.'
            : isClient
              ? 'Nu ai niciun document de încărcat momentan.'
              : 'Nu ai documente de verificat sau de urmărit la client.'}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl py-4 md:px-6 space-y-3">
      {items.length > 0 && (
      <div className="border border-[var(--p-border)] bg-[var(--p-surface)] rounded-[var(--radius-plate)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--p-border)] bg-paper-sunk">
          <div className="w-7 h-7 rounded-[var(--radius-plate)] flex items-center justify-center flex-shrink-0" style={{ background: TONE[isClient ? 'pending' : 'review'].bg, color: TONE[isClient ? 'pending' : 'review'].fg }}>
            <ListChecks className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[var(--p-ink)]">
              {isClient ? 'Ce ai de încărcat' : 'De revizuit'}
            </h3>
            <p className="text-[11px] text-[var(--p-ink-soft)] mt-0.5">
              {overdueCount > 0 && (
                <span className="text-[var(--p-danger)] font-semibold">{overdueCount} depășite · </span>
              )}
              {items.length} document{items.length === 1 ? '' : 'e'} · apasă pentru a {isClient ? 'sări la etapă' : 'deschide și aprobă/respinge'}
            </p>
          </div>
        </div>
        <div className="divide-y divide-[var(--p-border)]">
          {renderRows(items)}
        </div>
      </div>
      )}

      {!isClient && waitingItems.length > 0 && (
      <div className="border border-[var(--p-border)] bg-[var(--p-surface)] rounded-[var(--radius-plate)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--p-border)] bg-paper-sunk">
          <div className="w-7 h-7 rounded-[var(--radius-plate)] bg-[var(--sg-pending-soft)] flex items-center justify-center flex-shrink-0">
            <Clock className="w-4 h-4 text-[var(--sg-pending)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[var(--p-ink)]">Așteptăm documente de la client</h3>
            <p className="text-[11px] text-[var(--p-ink-soft)] mt-0.5">
              {waitingOverdueCount > 0 && (
                <span className="text-[var(--p-danger)] font-semibold">{waitingOverdueCount} cu termen depășit · </span>
              )}
              {waitingItems.length} document{waitingItems.length === 1 ? '' : 'e'} la client
            </p>
          </div>
        </div>
        <div className="divide-y divide-[var(--p-border)]">
          {renderRows(waitingItems, true)}
        </div>
      </div>
      )}
    </div>
  )
}
