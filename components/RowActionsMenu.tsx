'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, MoreHorizontal } from 'lucide-react'

export interface RowAction {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Ascunde acțiunea fără să schimbi structura listei la apelant. */
  hidden?: boolean
  danger?: boolean
}

/** Colțul din care se ancorează meniul, în coordonate de fereastră. */
type MenuPosition = { right: number; top?: number; bottom?: number }

/**
 * Acțiunile secundare ale unui rând, strânse sub „⋯”: pe rânduri strâmte, trei
 * iconițe una lângă alta se citesc greu și cer ghicit ce face fiecare.
 *
 * Rândurile din pagina proiectului sunt clicabile în întregime, deci meniul
 * oprește propagarea și se închide la Escape, la click în afară și după orice
 * acțiune aleasă.
 *
 * Lista se randează în `document.body`, ancorată `fixed` la buton: cardurile de
 * fază și de activitate au `overflow-hidden` pentru colțurile rotunjite, iar un
 * meniu absolut în interiorul lor s-ar tăia la marginea cardului.
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
  /** Doar iconița e mai mică pe rândurile de activitate; ținta rămâne 32 px. */
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const visible = actions.filter(action => !action.hidden)

  /** Sub buton, aliniat la dreapta lui; deasupra, dacă jos nu mai încape. */
  const place = useCallback(() => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    const estimatedHeight = visible.length * 32 + 8
    setPosition(rect.bottom + 4 + estimatedHeight > window.innerHeight - 8
      ? { right, bottom: window.innerHeight - rect.top + 4 }
      : { right, top: rect.bottom + 4 })
  }, [visible.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); return }
      // Lista stă în `body`, la finalul documentului: ordinea naturală de
      // tabulare ar sări peste ea și ar lăsa meniul deschis în urmă. Focusul se
      // întoarce pe trigger *fără* `preventDefault`, deci Tab-ul continuă de
      // acolo, în rândul următor, nu de la începutul paginii.
      if (event.key === 'Tab') { setOpen(false); buttonRef.current?.focus(); return }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown'
        ? (at + 1) % items.length
        : (at - 1 + items.length) % items.length
      items[next].focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // `true`: rândul stă în panouri care se derulează, nu doar în fereastră.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  // La deschidere focusul trece pe primul item: altfel rămâne pe trigger, iar
  // săgețile n-au de unde porni.
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  if (visible.length === 0) return null

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'

  return (
    <div ref={rootRef} data-open={open} className={`flex-shrink-0 ${className}`} onClick={e => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) { setOpen(false); return }
          place()
          setOpen(true)
        }}
        disabled={busy}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open}
        className={`${size === 'sm' ? 'p-2.5' : 'p-2'} rounded text-[var(--p-ink-faint)] hover:text-[var(--p-ink)] hover:bg-[var(--p-surface-2)] disabled:opacity-60`}
      >
        {busy
          ? <Loader2 className={`${iconSize} animate-spin`} />
          : <MoreHorizontal className={iconSize} />}
      </button>

      {open && position && createPortal(
        // `project-scope` aduce cu el token-urile `--p-*`: sunt definite pe
        // domeniul paginii de proiect, iar aici, în `body`, fondul ar rămâne
        // transparent, cu rândul de dedesubt citindu-se prin meniu.
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', right: position.right, top: position.top, bottom: position.bottom }}
          className="project-scope z-50 min-w-[11rem] py-1 rounded-lg border border-[var(--p-border)] bg-[var(--p-surface)] shadow-[0_8px_24px_-8px_rgba(15,23,42,0.25)]"
        >
          {visible.map(action => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); action.onSelect() }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--p-surface-2)] ${
                action.danger ? 'text-[var(--p-danger)]' : 'text-[var(--p-ink)]'
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
