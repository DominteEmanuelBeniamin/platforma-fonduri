'use client'

import { useState } from 'react'
import { Check, Loader2, Trash2, X } from 'lucide-react'

interface InlineDateEditorProps {
  /** Valoarea de pornire, format YYYY-MM-DD */
  value?: string | null
  saving?: boolean
  /** Nu sugerăm date din trecut; serverul le acceptă în continuare. */
  minToday?: boolean
  /**
   * Permite salvarea cu câmpul golit, adică ștergerea termenului. Fals acolo
   * unde editorul există tocmai ca să completeze un termen care lipsește.
   */
  allowClear?: boolean
  onSave: (value: string) => void
  onCancel: () => void
  size?: 'sm' | 'md'
  label?: string
}

// „Azi" în fusul utilizatorului. `toISOString` ar da ziua în UTC, deci o parte
// din fiecare zi ar ieși cu limita mutată cu o zi.
function todayLocal() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Câmpul de dată editabil pe loc, cu salvare și renunțare — singurul din
 * aplicație. Folosit pentru termenul limită din sidebar, din fișa cererii și
 * din controlul de publicare.
 */
export default function InlineDateEditor({
  value,
  saving = false,
  minToday = false,
  allowClear = false,
  onSave,
  onCancel,
  size = 'md',
  label = 'Termen limită',
}: InlineDateEditorProps) {
  const [draft, setDraft] = useState(value ? value.slice(0, 10) : '')

  // Golirea câmpului șterge termenul, dar numai unde ștergerea are sens și
  // numai dacă exista ceva de șters.
  const clearing = !draft && allowClear && !!value
  const canSave = !saving && (!!draft || clearing)
  const save = () => { if (canSave) onSave(draft) }
  const saveLabel = clearing ? 'Șterge termenul' : 'Salvează'

  const inputClass = size === 'sm'
    ? 'text-xs px-1.5 py-0.5'
    : 'text-sm px-2 py-1'
  const buttonClass = size === 'sm' ? 'p-1' : 'p-1.5'
  const iconClass = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'

  return (
    <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <input
        type="date"
        autoFocus
        aria-label={label}
        value={draft}
        disabled={saving}
        min={minToday ? todayLocal() : undefined}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          if (e.key === 'Escape') onCancel()
        }}
        className={`${inputClass} rounded-md border border-[var(--p-accent)]/40 bg-[var(--p-surface)] text-[var(--p-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--p-accent)] disabled:opacity-50`}
      />
      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        title={saveLabel}
        aria-label={saveLabel}
        className={`${buttonClass} rounded-md flex-shrink-0 hover:opacity-80 disabled:opacity-40 ${
          clearing
            ? 'bg-[var(--p-surface-2)] text-[var(--p-danger)]'
            : 'bg-[var(--p-success-soft)] text-[var(--p-success)]'
        }`}
      >
        {saving
          ? <Loader2 className={`${iconClass} animate-spin`} />
          : clearing
          ? <Trash2 className={iconClass} />
          : <Check className={iconClass} />}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        title="Renunță"
        aria-label="Renunță"
        className={`${buttonClass} rounded-md bg-[var(--p-surface-2)] text-[var(--p-ink-soft)] hover:opacity-80 disabled:opacity-40 flex-shrink-0`}
      >
        <X className={iconClass} />
      </button>
    </span>
  )
}
