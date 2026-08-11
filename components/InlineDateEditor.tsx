'use client'

import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'

interface InlineDateEditorProps {
  /** Valoarea de pornire, format YYYY-MM-DD */
  value?: string | null
  saving?: boolean
  /** Nu sugerăm date din trecut; serverul le acceptă în continuare. */
  minToday?: boolean
  onSave: (value: string) => void
  onCancel: () => void
  size?: 'sm' | 'md'
  label?: string
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
  onSave,
  onCancel,
  size = 'md',
  label = 'Termen limită',
}: InlineDateEditorProps) {
  const [draft, setDraft] = useState(value ? value.slice(0, 10) : '')

  const save = () => { if (draft && !saving) onSave(draft) }

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
        min={minToday ? new Date().toISOString().slice(0, 10) : undefined}
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
        disabled={!draft || saving}
        title="Salvează"
        aria-label="Salvează"
        className={`${buttonClass} rounded-md bg-[var(--p-success-soft)] text-[var(--p-success)] hover:opacity-80 disabled:opacity-40 flex-shrink-0`}
      >
        {saving ? <Loader2 className={`${iconClass} animate-spin`} /> : <Check className={iconClass} />}
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
