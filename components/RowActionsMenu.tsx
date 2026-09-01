'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, MoreHorizontal } from 'lucide-react'

export interface RowAction {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Ascunde acțiunea fără să schimbi structura listei la apelant. */
  hidden?: boolean
  danger?: boolean
}

/**
 * Acțiunile secundare ale unui rând, strânse sub „⋯”: pe rânduri strâmte, trei
 * iconițe una lângă alta se citesc greu și cer ghicit ce face fiecare.
 *
 * Rândurile din pagina proiectului sunt clicabile în întregime, deci meniul
 * oprește propagarea și se închide la Escape, la click în afară și după orice
 * acțiune aleasă.
 */
export default function RowActionsMenu({
  label,
  actions,
  busy = false,
  size = 'md',
  className = '',
}: {
  /** Ce apare în `aria-label`: „Acțiuni pentru faza X”. */
  label: string
  actions: RowAction[]
  busy?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const visible = actions.filter(action => !action.hidden)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (visible.length === 0) return null

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'

  return (
    <div ref={rootRef} data-open={open} className={`relative flex-shrink-0 ${className}`} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        disabled={busy}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open}
        className={`${size === 'sm' ? 'p-0.5' : 'p-1'} rounded text-[var(--p-ink-faint)] hover:text-[var(--p-ink)] hover:bg-[var(--p-surface-2)] disabled:opacity-60`}
      >
        {busy
          ? <Loader2 className={`${iconSize} animate-spin`} />
          : <MoreHorizontal className={iconSize} />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] py-1 rounded-lg border border-[var(--p-border)] bg-[var(--p-surface)] shadow-[0_8px_24px_-8px_rgba(15,23,42,0.25)]"
        >
          {visible.map(action => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); action.onSelect() }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--p-surface-2)] ${
                action.danger ? 'text-[var(--p-danger)]' : 'text-[var(--p-ink)]'
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
