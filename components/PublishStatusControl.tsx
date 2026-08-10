'use client'

import { useState } from 'react'
import { CalendarClock, Check, Loader2, UserRound, X } from 'lucide-react'
import { BLOCKER_ASSIGNEE, BLOCKER_DEADLINE, PUBLISH_BLOCKERS } from '@/lib/publish-rules'

interface PublishStatusControlProps {
  status: 'draft' | 'published'
  canPublish: boolean
  onPublish: () => void
  /**
   * Ce lipsește ca elementul să poată fi publicat — codurile din
   * `lib/publish-rules`, aceleași pe care le verifică serverul. Cât timp lista
   * nu e goală, comutatorul apare dezactivat, iar lipsurile se văd fără click.
   */
  blockers?: string[]
  /** Dacă sunt date, lipsurile se completează pe loc, fără a pleca din pagină. */
  onSetDeadline?: (value: string) => Promise<void> | void
  onAssign?: (consultantId: string) => Promise<void> | void
  assignOptions?: { id: string; label: string }[]
  size?: 'sm' | 'md'
}

/**
 * Comutatorul de stare „În pregătire" / „Public" (#53), cu regulile de
 * publicare din #70: un element incomplet nu poate deveni public.
 */
export default function PublishStatusControl({
  status,
  canPublish,
  onPublish,
  blockers = [],
  onSetDeadline,
  onAssign,
  assignOptions = [],
  size = 'md',
}: PublishStatusControlProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deadlineValue, setDeadlineValue] = useState('')

  const isDraft = status === 'draft'
  const textClass = size === 'sm' ? 'text-xs' : 'text-[13px]'
  const colorClass = isDraft ? 'text-slate-500' : 'text-emerald-600'

  if (!canPublish || !isDraft) {
    return (
      <span className={`inline-flex items-center gap-1.5 flex-shrink-0 ${textClass} ${colorClass}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {isDraft ? 'În pregătire' : 'Public'}
      </span>
    )
  }

  const toggleVisual = (
    <span className="relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full bg-slate-300 transition-colors">
      <span className="inline-block h-3 w-3 translate-x-0.5 transform rounded-full bg-white shadow transition-transform" />
    </span>
  )

  if (blockers.length === 0) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={false}
        onClick={e => { e.stopPropagation(); onPublish() }}
        title="Apasă ca să publici — devine vizibil clientului"
        className={`inline-flex items-center gap-2 flex-shrink-0 ${textClass}`}
      >
        {toggleVisual}
        <span className={colorClass}>În pregătire</span>
      </button>
    )
  }

  // Parintele afișează motivul eșecului și aruncă mai departe; păstrăm editorul
  // deschis cu valoarea tastată, ca omul să nu o scrie a doua oară.
  const runSave = async (save: () => Promise<void> | void) => {
    setSaving(true)
    try {
      await save()
      setEditing(null)
    } catch {
      // motivul e deja pe ecran, sub formă de toast
    } finally {
      setSaving(false)
    }
  }

  const chipClass = 'inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-slate-500 transition-colors'

  // O lipsă e completabilă pe loc doar dacă părintele a dat cu ce.
  const canEditHere = (blocker: string) =>
    (blocker === BLOCKER_DEADLINE && Boolean(onSetDeadline)) ||
    (blocker === BLOCKER_ASSIGNEE && Boolean(onAssign) && assignOptions.length > 0)

  const labels: Record<string, { short: string; long: string }> = PUBLISH_BLOCKERS
  const missingLabel = (blocker: string) => labels[blocker]?.short ?? blocker
  const missingIcon = (blocker: string) =>
    blocker === BLOCKER_ASSIGNEE ? <UserRound className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />

  return (
    // Oprim propagarea și pentru taste: controlul stă în interiorul unor rânduri
    // care se deschid la click sau la Enter/Space.
    <span
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      className={`inline-flex flex-col items-start gap-1 flex-shrink-0 ${textClass}`}
    >
      <span
        role="switch"
        aria-checked={false}
        aria-disabled
        title={`Nu poate fi publicat: lipsește ${blockers.map(missingLabel).join(' și ')}`}
        className="inline-flex items-center gap-2 opacity-60 cursor-not-allowed"
      >
        {toggleVisual}
        <span className={colorClass}>În pregătire</span>
      </span>

      <span className="inline-flex flex-wrap items-center gap-1 text-[11px] leading-tight text-slate-400">
        <span>Ca să publici:</span>

        {blockers.map(blocker => {
          if (editing === blocker && blocker === BLOCKER_DEADLINE && onSetDeadline) {
            return (
              <span key={blocker} className="inline-flex items-center gap-1">
                <input
                  type="date"
                  autoFocus
                  value={deadlineValue}
                  // Un termen deja trecut ar trece de regulă, dar ar publica
                  // elementul direct în întârziere. Serverul nu îl refuză —
                  // aici doar nu îl sugerăm.
                  min={new Date().toISOString().slice(0, 10)}
                  disabled={saving}
                  onChange={e => setDeadlineValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); if (deadlineValue) runSave(() => onSetDeadline(deadlineValue)) }
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  aria-label="Termen limită"
                  className="rounded-md border border-indigo-300 bg-white px-1.5 py-0.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => runSave(() => onSetDeadline(deadlineValue))}
                  disabled={!deadlineValue || saving}
                  title="Salvează termenul"
                  aria-label="Salvează termenul"
                  className="rounded-md bg-emerald-100 p-1 text-emerald-600 hover:bg-emerald-200 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={saving}
                  title="Renunță"
                  aria-label="Renunță"
                  className="rounded-md bg-slate-200 p-1 text-slate-500 hover:bg-slate-300 disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )
          }

          if (editing === blocker && blocker === BLOCKER_ASSIGNEE && onAssign) {
            return (
              <span key={blocker} className="inline-flex items-center gap-1">
                <select
                  autoFocus
                  defaultValue=""
                  disabled={saving}
                  onChange={e => { if (e.target.value) runSave(() => onAssign(e.target.value)) }}
                  onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }}
                  aria-label="Consultant responsabil"
                  className="max-w-[10rem] truncate rounded-md border border-indigo-300 bg-white px-1.5 py-0.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="" disabled>Alege consultantul</option>
                  {assignOptions.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                {saving && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={saving}
                  title="Renunță"
                  aria-label="Renunță"
                  className="rounded-md bg-slate-200 p-1 text-slate-500 hover:bg-slate-300 disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )
          }

          if (!canEditHere(blocker)) {
            return (
              <span key={blocker} className={chipClass}>
                {missingIcon(blocker)}
                {missingLabel(blocker)}
              </span>
            )
          }

          return (
            <button
              key={blocker}
              type="button"
              onClick={() => setEditing(blocker)}
              title={`Completează ${missingLabel(blocker)}`}
              className={`${chipClass} hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600`}
            >
              {missingIcon(blocker)}
              {missingLabel(blocker)}
            </button>
          )
        })}
      </span>
    </span>
  )
}
