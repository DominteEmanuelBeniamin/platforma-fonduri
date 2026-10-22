'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { useLeaveField } from '@/hooks/useLeaveField'

/**
 * Câmp scurt, confirmat cu Enter și abandonat cu Escape. Servește și la
 * adăugare (fără `initialValue`), și la redenumire (cu numele curent).
 *
 * Plecarea din câmp (clic în afară, Tab mai departe) îl încheie ca în monday:
 * la redenumire, un nume schimbat și negol se salvează, altfel nu se schimbă
 * nimic; la adăugare, un câmp gol se închide, iar unul cu text se creează.
 */
export default function InlineInput({
  placeholder,
  onConfirm,
  onCancel,
  loading,
  initialValue = '',
  size = 'sm',
  label,
}: {
  placeholder: string
  onConfirm: (value: string) => void
  onCancel: () => void
  loading: boolean
  initialValue?: string
  size?: 'sm' | 'md'
  /** Numele accesibil al câmpului, când placeholder-ul nu ajunge. */
  label?: string
}) {
  const [value, setValue] = useState(initialValue)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const iconSize = size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'
  // Un singur deznodământ pe plecare: un clic în afară mută și focusul, deci
  // ar ajunge de două ori. Dacă salvarea cade, câmpul rămâne și se poate
  // pleca din nou.
  const settled = useRef(false)
  useEffect(() => { if (!loading) settled.current = false }, [loading])

  const finish = () => {
    if (loading || settled.current) return
    const next = value.trim()
    const original = initialValue.trim()
    settled.current = true
    if (next && next !== original) onConfirm(next)
    else onCancel()
  }

  useLeaveField(rootRef, true, finish)

  // La redenumire, numele intră selectat, cu punctul de focus la început:
  // `autoFocus` singur lasă cursorul la coadă, iar pe un nume care nu încape în
  // câmp se vedea doar sfârșitul lui — nu se știa ce se redenumește.
  useEffect(() => {
    const input = inputRef.current
    if (!input || !initialValue) return
    input.setSelectionRange(0, initialValue.length, 'backward')
    // Selecția singură nu derulează câmpul înapoi: `autoFocus` a dus deja
    // vederea la coada numelui.
    input.scrollLeft = 0
  }, [initialValue])

  return (
    <div ref={rootRef} className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        autoFocus
        title={initialValue || undefined}
        aria-label={label}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) finish()
          if (e.key === 'Escape') { settled.current = true; onCancel() }
        }}
        placeholder={placeholder}
        disabled={loading}
        className={`flex-1 min-w-0 ${size === 'md' ? 'text-sm' : 'text-xs'} px-2 py-1.5 border border-[var(--p-accent)]/40 rounded-md focus:outline-none focus:ring-1 focus:ring-[var(--p-accent)] bg-[var(--p-surface)] text-[var(--p-ink)] placeholder:text-[var(--p-ink-faint)]`}
      />
      <button
        onClick={finish}
        disabled={loading || !value.trim()}
        aria-label={initialValue ? 'Salvează numele' : 'Adaugă'}
        className="p-1 rounded bg-[var(--p-success-soft)] text-[var(--p-success)] hover:opacity-80 disabled:opacity-40"
      >
        {loading ? <Loader2 className={`${iconSize} animate-spin`} /> : <Check className={iconSize} />}
      </button>
      <button
        onClick={() => { settled.current = true; onCancel() }}
        aria-label={initialValue ? 'Renunță la redenumire' : 'Renunță'}
        className="p-1 rounded bg-[var(--p-surface-2)] text-[var(--p-ink-soft)] hover:opacity-80"
      >
        <X className={iconSize} />
      </button>
    </div>
  )
}
