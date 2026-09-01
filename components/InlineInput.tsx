'use client'

import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'

/**
 * Câmp scurt, confirmat cu Enter și abandonat cu Escape. Servește și la
 * adăugare (fără `initialValue`), și la redenumire (cu numele curent).
 */
export default function InlineInput({
  placeholder,
  onConfirm,
  onCancel,
  loading,
  initialValue = '',
  size = 'sm',
}: {
  placeholder: string
  onConfirm: (value: string) => void
  onCancel: () => void
  loading: boolean
  initialValue?: string
  size?: 'sm' | 'md'
}) {
  const [value, setValue] = useState(initialValue)
  const iconSize = size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'

  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        disabled={loading}
        className={`flex-1 min-w-0 ${size === 'md' ? 'text-sm' : 'text-xs'} px-2 py-1.5 border border-[var(--p-accent)]/40 rounded-md focus:outline-none focus:ring-1 focus:ring-[var(--p-accent)] bg-[var(--p-surface)] text-[var(--p-ink)] placeholder:text-[var(--p-ink-faint)]`}
      />
      <button
        onClick={() => value.trim() && onConfirm(value.trim())}
        disabled={loading || !value.trim()}
        aria-label="Salvează numele"
        className="p-1 rounded bg-[var(--p-success-soft)] text-[var(--p-success)] hover:opacity-80 disabled:opacity-40"
      >
        {loading ? <Loader2 className={`${iconSize} animate-spin`} /> : <Check className={iconSize} />}
      </button>
      <button
        onClick={onCancel}
        aria-label="Renunță la redenumire"
        className="p-1 rounded bg-[var(--p-surface-2)] text-[var(--p-ink-soft)] hover:opacity-80"
      >
        <X className={iconSize} />
      </button>
    </div>
  )
}
