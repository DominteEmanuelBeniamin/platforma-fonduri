'use client'

import { useState } from 'react'
import { CheckCircle2, Clock, Loader2, X } from 'lucide-react'

interface PublishStatusControlProps {
  status: 'draft' | 'published'
  canPublish: boolean
  onPublish: () => void
  /**
   * Motivul pentru care publicarea nu e posibilă acum, deși utilizatorul are
   * dreptul să publice (ex: lipsește termenul limită — #70). Comutatorul apare
   * dezactivat, iar motivul se vede fără să fie nevoie de click.
   */
  disabledReason?: string | null
  /** Dacă e dat, motivul devine acționabil: termenul se setează pe loc. */
  onSetDeadline?: (value: string) => Promise<void> | void
  size?: 'sm' | 'md'
}

/**
 * Comutatorul de stare „În pregătire" / „Public" (#53), cu regula din #70:
 * un element fără termen limită nu poate fi publicat.
 */
export default function PublishStatusControl({
  status,
  canPublish,
  onPublish,
  disabledReason,
  onSetDeadline,
  size = 'md',
}: PublishStatusControlProps) {
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [deadlineValue, setDeadlineValue] = useState('')
  const [savingDeadline, setSavingDeadline] = useState(false)

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

  if (disabledReason) {
    const saveDeadline = async () => {
      if (!deadlineValue || !onSetDeadline) return
      setSavingDeadline(true)
      try {
        await onSetDeadline(deadlineValue)
        setEditingDeadline(false)
      } finally {
        setSavingDeadline(false)
      }
    }

    return (
      <span
        onClick={e => e.stopPropagation()}
        className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 flex-shrink-0 ${textClass}`}
      >
        <span
          role="switch"
          aria-checked={false}
          aria-disabled
          title={disabledReason}
          className="inline-flex items-center gap-2 opacity-60 cursor-not-allowed"
        >
          {toggleVisual}
          <span className={colorClass}>În pregătire</span>
        </span>

        {editingDeadline ? (
          <span className="inline-flex items-center gap-1">
            <input
              type="date"
              autoFocus
              value={deadlineValue}
              disabled={savingDeadline}
              onChange={e => setDeadlineValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); saveDeadline() }
                if (e.key === 'Escape') setEditingDeadline(false)
              }}
              aria-label="Termen limită"
              className="px-1.5 py-0.5 border border-indigo-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={saveDeadline}
              disabled={!deadlineValue || savingDeadline}
              title="Salvează termenul"
              aria-label="Salvează termenul"
              className="p-1 rounded-md bg-emerald-100 text-emerald-600 hover:bg-emerald-200 disabled:opacity-50"
            >
              {savingDeadline ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={() => setEditingDeadline(false)}
              title="Renunță"
              aria-label="Renunță"
              className="p-1 rounded-md bg-slate-200 text-slate-500 hover:bg-slate-300"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ) : (
          <>
            <span className="text-slate-400">{disabledReason}</span>
            {onSetDeadline && (
              <button
                type="button"
                onClick={() => setEditingDeadline(true)}
                className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
              >
                <Clock className="w-3 h-3" />
                Adaugă termen
              </button>
            )}
          </>
        )}
      </span>
    )
  }

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
