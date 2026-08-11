'use client'

import { useState } from 'react'
import { CalendarClock, UserRound } from 'lucide-react'
import { BLOCKER_ASSIGNEE, BLOCKER_DEADLINE, PUBLISH_BLOCKERS } from '@/lib/publish-rules'
import InlineDateEditor from '@/components/InlineDateEditor'

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
  /** Dacă e dat, termenul se completează pe loc, fără a pleca din pagină. */
  onSetDeadline?: (value: string) => Promise<void> | void
  size?: 'sm' | 'md'
}

/**
 * Comutatorul de stare „În pregătire" / „Public" (#53), cu regulile de
 * publicare din #70: un element incomplet nu poate deveni public.
 *
 * Responsabilul se atribuie din controlul care există deja pe fiecare ecran
 * (selectul din antetul activității, rândul „Responsabil" din fișa cererii);
 * aici doar se vede că lipsește.
 */
export default function PublishStatusControl({
  status,
  canPublish,
  onPublish,
  blockers = [],
  onSetDeadline,
  size = 'md',
}: PublishStatusControlProps) {
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [saving, setSaving] = useState(false)

  const isDraft = status === 'draft'
  const textClass = size === 'sm' ? 'text-xs' : 'text-[13px]'

  if (!canPublish || !isDraft) {
    return (
      <span className={`inline-flex items-center gap-1.5 flex-shrink-0 ${textClass} ${
        isDraft ? 'text-slate-500' : 'text-emerald-600'
      }`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {isDraft ? 'În pregătire' : 'Public'}
      </span>
    )
  }

  // Sub acest punct elementul e sigur „În pregătire" și poate fi publicat:
  // restul componentei arată doar comutatorul de dinaintea publicării.
  const draftClass = 'text-slate-500'

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
        <span className={draftClass}>În pregătire</span>
      </button>
    )
  }

  // Părintele arată motivul eșecului și aruncă mai departe; ținem editorul
  // deschis, ca omul să nu tasteze data a doua oară.
  const saveDeadline = async (value: string) => {
    if (!onSetDeadline) return
    setSaving(true)
    try {
      await onSetDeadline(value)
      setEditingDeadline(false)
    } catch {
      // motivul e deja pe ecran, sub formă de toast
    } finally {
      setSaving(false)
    }
  }

  const labels: Record<string, { short: string; long: string }> = PUBLISH_BLOCKERS
  const missingLabel = (blocker: string) => labels[blocker]?.short ?? blocker
  const chipClass = 'inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-slate-500 transition-colors'

  return (
    // Oprim propagarea și pentru taste: controlul stă în interiorul unor rânduri
    // care se deschid la click.
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
        <span className={draftClass}>În pregătire</span>
      </span>

      <span className="inline-flex flex-wrap items-center gap-1 text-[11px] leading-tight text-slate-400">
        <span>Ca să publici:</span>

        {blockers.map(blocker => {
          if (blocker === BLOCKER_DEADLINE && editingDeadline && onSetDeadline) {
            return (
              <InlineDateEditor
                key={blocker}
                size="sm"
                minToday
                saving={saving}
                onSave={saveDeadline}
                onCancel={() => setEditingDeadline(false)}
              />
            )
          }

          const icon = blocker === BLOCKER_ASSIGNEE
            ? <UserRound className="w-3 h-3" />
            : <CalendarClock className="w-3 h-3" />

          if (blocker === BLOCKER_DEADLINE && onSetDeadline) {
            return (
              <button
                key={blocker}
                type="button"
                onClick={() => setEditingDeadline(true)}
                title="Completează termenul limită"
                className={`${chipClass} hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600`}
              >
                {icon}
                {missingLabel(blocker)}
              </button>
            )
          }

          return (
            <span key={blocker} className={chipClass}>
              {icon}
              {missingLabel(blocker)}
            </span>
          )
        })}
      </span>
    </span>
  )
}
