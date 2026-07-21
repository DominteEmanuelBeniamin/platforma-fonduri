'use client'

import { AlertTriangle, Clock, FileText, ListChecks } from 'lucide-react'

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
  isClient: boolean
  onJump: (phaseId: string | null, activityId: string | null, requestId?: string) => void
}

export default function ActionNeededPanel({ items, isClient, onJump }: ActionNeededPanelProps) {
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)
  const overdueCount = items.filter(r => {
    if (!r.deadline_at) return false
    const d = new Date(r.deadline_at)
    d.setHours(0, 0, 0, 0)
    return d < todayMidnight
  }).length

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 sm:p-12">
        <div className="w-16 h-16 bg-[var(--p-success-soft)] rounded-2xl flex items-center justify-center mb-4">
          <ListChecks className="w-8 h-8 text-[var(--p-success)]" />
        </div>
        <h2 className="font-display text-lg font-semibold text-[var(--p-ink)] mb-1">Nimic în așteptare</h2>
        <p className="text-sm text-[var(--p-ink-soft)] max-w-xs">
          {isClient
            ? 'Nu ai niciun document de încărcat momentan.'
            : 'Niciun document nu așteaptă revizuirea ta.'}
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="border border-[var(--p-accent-soft)] bg-[var(--p-accent-soft)]/40 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--p-accent-soft)]">
          <div className="w-8 h-8 rounded-lg bg-[var(--p-surface)] border border-[var(--p-accent-soft)] flex items-center justify-center flex-shrink-0">
            <ListChecks className="w-4 h-4 text-[var(--p-accent)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[var(--p-ink)]">
              {isClient ? 'Ce ai de încărcat' : 'De revizuit'}
            </h3>
            <p className="text-[11px] text-[var(--p-ink-soft)] mt-0.5">
              {overdueCount > 0 && (
                <span className="text-[var(--p-danger)] font-semibold">{overdueCount} expirate · </span>
              )}
              {items.length} document{items.length === 1 ? '' : 'e'} · apasă pentru a {isClient ? 'sări la etapă' : 'deschide și aprobă/respinge'}
            </p>
          </div>
        </div>
        <div className="divide-y divide-[var(--p-accent-soft)] max-h-[560px] overflow-y-auto">
          {items.map(req => {
            const deadline = req.deadline_at ? new Date(req.deadline_at) : null
            deadline?.setHours(0, 0, 0, 0)
            const isOverdue = deadline && deadline < todayMidnight
            const isRejected = req.status === 'rejected'
            return (
              <button
                key={req.id}
                onClick={() => onJump(req.phase_id, req.activity_id, req.id)}
                className="group w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--p-surface)]/70 transition-colors"
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isOverdue || isRejected ? 'bg-[var(--p-danger-soft)]' : 'bg-[var(--p-warning-soft)]'
                }`}>
                  {isOverdue || isRejected
                    ? <AlertTriangle className="w-3.5 h-3.5 text-[var(--p-danger)]" />
                    : <FileText className="w-3.5 h-3.5 text-[var(--p-warning)]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold truncate leading-snug ${isOverdue ? 'text-[var(--p-danger)]' : 'text-[var(--p-ink)]'}`}>
                    {req.name}
                  </p>
                  <p className="text-[11px] text-[var(--p-ink-faint)] truncate mt-0.5">
                    {req.phase_name
                      ? <>{req.phase_name}{req.activity_name && <span className="text-[var(--p-border-strong)]"> / {req.activity_name}</span>}</>
                      : 'Cereri generale'}
                  </p>
                </div>
                {deadline && (
                  <div className={`hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0 ${
                    isOverdue ? 'bg-[var(--p-danger-soft)] text-[var(--p-danger)]' : 'bg-[var(--p-surface)] text-[var(--p-ink-soft)] border border-[var(--p-border)]'
                  }`}>
                    <Clock className="w-2.5 h-2.5" />
                    {deadline.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
                  </div>
                )}
                <span className={`hidden md:inline-flex flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  isRejected ? 'bg-[var(--p-danger-soft)] text-[var(--p-danger)]' : 'bg-[var(--p-warning-soft)] text-[var(--p-warning)]'
                }`}>
                  {isRejected ? 'Respins' : isClient ? 'De încărcat' : 'De revizuit'}
                </span>
                <span className="flex-shrink-0 text-xs font-semibold text-[var(--p-accent)] group-hover:opacity-80 transition-opacity" aria-hidden>→</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
