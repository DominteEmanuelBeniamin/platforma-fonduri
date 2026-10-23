'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, UserRound } from 'lucide-react'
import { getInitials } from '@/lib/avatar'
import { profileDisplayName } from '@/lib/profile-display'
import { filterItems, isEmptyQuery } from '@/lib/search'
import { Highlight } from '@/components/ui/Highlight'

export type Member = {
  id: string
  full_name: string | null
  email: string
  is_active?: boolean | null
}

type Person = { full_name?: string | null; email?: string | null; is_active?: boolean | null }

/** Inițialele cuiva, pe o plăcuță pătrată — nimic nu e rotund în Bonie. */
export function Initials({ name, email, muted = false }: { name?: string | null; email?: string | null; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-[10px] font-bold ${
        muted ? 'border border-dashed border-rule-strong text-ink-faint' : 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]'
      }`}
    >
      {muted ? <UserRound className="h-3 w-3" /> : getInitials(name, email)}
    </span>
  )
}

const PANEL_WIDTH = 272

/**
 * Alegerea responsabilului, ca în monday: un clic pe persoană deschide un
 * panou mic cu căutare și echipa — inițiale, nume, bifă pe cel ales — și „Fără
 * responsabil” la coadă. Căutarea e mereu acolo: echipa unui proiect poate fi
 * mare, iar numele se tastează mai repede decât se caută cu ochii. Înlocuiește `select`-ul nativ, a cărui listă o
 * desenează sistemul de operare și nu arată ca restul aplicației.
 *
 * Panoul se randează în `body`, ancorat `fixed` la buton, ca `RowActionsMenu`:
 * rândurile tabelului nu trebuie să-l taie. Tastatura: săgețile se plimbă prin
 * listă, Enter alege, Escape închide și întoarce focusul pe buton.
 */
export function AssigneePicker({
  value,
  person,
  members,
  onChange,
  label,
  title = 'Responsabil',
  emptyLabel = 'Neatribuită',
  allowEmpty = true,
  emptyBlockedReason = 'Activitatea e vizibilă clientului: trebuie să aibă un responsabil.',
}: {
  value: string | null | undefined
  /** Persoana aleasă acum, cu numele ei — poate fi și un cont dezactivat. */
  person: Person | null | undefined
  members: Member[]
  onChange: (id: string | null) => void
  /** Numele accesibil al butonului: „Atribuie consultant: Ana Popescu”. */
  label: string
  title?: string
  emptyLabel?: string
  /**
   * `false` pe un element public: „Fără responsabil” rămâne în listă, dar
   * dezactivat și cu motivul sub el. Serverul refuză oricum golirea (#70), iar
   * fără asta omul afla abia din eroare că alegerea nu era voie.
   */
  allowEmpty?: boolean
  emptyBlockedReason?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const emptyReasonId = useId()

  const active = members.filter(m => m.is_active !== false)
  const searching = !isEmptyQuery(query)
  const shown = filterItems(active, query, m => [
    { key: 'name', label: 'Nume', value: profileDisplayName(m) },
    { key: 'email', label: 'Email', value: m.email },
  ])
  const current = value ? person ?? members.find(m => m.id === value) ?? null : null
  const name = value ? profileDisplayName(current) : null
  // Un responsabil cu contul dezactivat rămâne afișat, dar nu se mai poate alege.
  const inactiveCurrent = !!value && current?.is_active === false

  /** Sub buton; deasupra, dacă jos nu mai încape. Mereu în ecran pe orizontală. */
  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8))
    const estimated = Math.min(360, (active.length + 2) * 36 + 44 + 32)
    setPosition(rect.bottom + 4 + estimated > window.innerHeight - 8 && rect.top > estimated
      ? { left, bottom: window.innerHeight - rect.top + 4 }
      : { left, top: rect.bottom + 4 })
  }, [active.length])

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setQuery('')
    if (refocus) buttonRef.current?.focus()
  }, [])

  const choose = (id: string | null) => {
    close()
    if (id !== (value ?? null)) onChange(id)
  }

  useEffect(() => {
    if (!open) return
    const options = () => [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled]):not([aria-disabled="true"])') ?? [])]
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) close(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      // Panoul stă la finalul documentului: Tab-ul ar fugi din el și l-ar lăsa
      // deschis. Focusul revine pe buton, iar Tab-ul continuă de acolo.
      if (event.key === 'Tab') { close(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = options()
      if (items.length === 0) return
      event.preventDefault()
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (at + 1) % items.length
        : at <= 0 ? items.length - 1 : at - 1
      items[next].focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place, close])

  // La deschidere focusul e în căutare: se poate tasta direct numele.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [open])

  // `blocked` e `aria-disabled`, nu `disabled`: opțiunea rămâne citită de
  // cititoarele de ecran, cu motivul legat de ea.
  const option = (id: string | null, who: Person | null, text: string, disabled = false, blocked = false) => {
    const selected = (value ?? null) === id
    return (
      <button
        key={id ?? '__none__'}
        type="button"
        role="option"
        aria-selected={selected}
        disabled={disabled}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? emptyReasonId : undefined}
        onClick={() => { if (!blocked) choose(id) }}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-[13px] text-ink transition-colors duration-[120ms] hover:bg-paper focus-visible:bg-paper focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:text-ink-faint aria-disabled:cursor-not-allowed aria-disabled:text-ink-faint aria-disabled:hover:bg-transparent pointer-fine:min-h-9"
      >
        <Initials name={who?.full_name} email={who?.email} muted={!id} />
        <span className={`min-w-0 flex-1 truncate ${id ? '' : 'text-ink-soft'}`}>{id ? <Highlight text={text} query={query} /> : text}</span>
        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--sg-accent)]" strokeWidth={2.5} aria-hidden="true" />}
      </button>
    )
  }

  return (
    <span ref={rootRef} className="inline-flex min-w-0 max-w-full" onClick={e => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${name ?? emptyLabel}`}
        data-tooltip={`${title}: ${name ?? emptyLabel}. Apasă ca să schimbi.`}
        data-open={open}
        onClick={() => {
          if (open) { close(); return }
          place()
          setOpen(true)
        }}
        className="group/assignee inline-flex min-h-8 min-w-0 max-w-full items-center gap-2 rounded-[var(--radius-plate)] px-1.5 text-left text-xs transition-colors duration-[120ms] hover:bg-paper-sunk data-[open=true]:bg-paper-sunk pointer-fine:min-h-7"
      >
        <Initials name={current?.full_name} email={current?.email} muted={!value} />
        <span className={`min-w-0 truncate ${value ? 'text-ink-soft' : 'text-ink-faint'}`}>{name ?? emptyLabel}</span>
        <ChevronDown
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity duration-[120ms] group-hover/assignee:opacity-100 group-focus-visible/assignee:opacity-100 group-data-[open=true]/assignee:opacity-100 pointer-coarse:opacity-100"
        />
      </button>

      {open && position && createPortal(
        <div
          ref={panelRef}
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', left: position.left, top: position.top, bottom: position.bottom, width: PANEL_WIDTH }}
          className="z-50 overflow-hidden rounded-[var(--radius-plate-lg)] border border-rule bg-plate shadow-[var(--sg-lift)]"
        >
          <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-ink-faint">{title}</p>
          <div className="relative mx-2 mb-1.5">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                // Săgeata coboară în listă; Enter alege prima potrivire.
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  panelRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not([disabled])')?.focus()
                }
                if (e.key === 'Enter' && searching && shown[0]) {
                  e.preventDefault()
                  choose(shown[0].id)
                }
              }}
              placeholder="Caută după nume sau email"
              aria-label="Caută o persoană"
              className="h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate pl-7 pr-2 text-xs text-ink placeholder:text-ink-faint focus:border-[var(--sg-accent)] pointer-fine:h-8"
            />
          </div>
          {shown.length === 0 && (
            <p className="px-3 py-2 text-xs leading-5 text-ink-faint">
              {searching ? 'Nimeni din echipa proiectului nu se potrivește.' : 'Echipa proiectului e goală.'} Adaugă oameni din „Echipa”, sus.
            </p>
          )}
          <div role="listbox" aria-label={label} className="max-h-64 overflow-y-auto pb-1">
            {inactiveCurrent && option(value!, current, profileDisplayName(current), true)}
            {shown.map(m => option(m.id, m, profileDisplayName(m)))}
            <div className="mt-1 border-t border-rule pt-1">
              {option(null, null, 'Fără responsabil', false, !allowEmpty)}
              {!allowEmpty && (
                <p id={emptyReasonId} className="px-3 pb-1.5 text-[11px] leading-4 text-ink-faint">{emptyBlockedReason}</p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}
