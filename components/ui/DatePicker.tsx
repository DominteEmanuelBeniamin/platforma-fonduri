'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import { ro } from 'react-day-picker/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'

/**
 * Calendarul aplicației, pe `react-day-picker` — aceeași bibliotecă pe care o
 * folosește shadcn/ui pentru `Calendar` și `DatePicker`. Înlocuiește câmpul de
 * dată al browserului, pe care fiecare sistem de operare îl desenează altfel.
 *
 * Valorile intră și ies ca `YYYY-MM-DD` — ce trimitea și `<input type="date">` —,
 * deci apelanții și serverul nu se schimbă.
 */

/** `YYYY-MM-DD` (sau un ISO întreg) → ziua, în fusul utilizatorului. */
export function parseDay(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

/** Ziua → `YYYY-MM-DD`, tot în fusul utilizatorului: `toISOString` ar muta-o. */
export function toDayString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function startOfToday() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

const NAV_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-plate)] text-ink-soft transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink disabled:opacity-40'

/** Calendarul propriu-zis: o lună, săptămâna de luni, în română. */
export function Calendar({
  selected,
  onSelect,
  minToday = false,
}: {
  selected: Date | undefined
  onSelect: (date: Date) => void
  /** Nu se aleg zile din trecut (termenele noi). */
  minToday?: boolean
}) {
  return (
    <DayPicker
      mode="single"
      locale={ro}
      required
      autoFocus
      selected={selected}
      defaultMonth={selected ?? startOfToday()}
      onSelect={date => { if (date) onSelect(date) }}
      disabled={minToday ? { before: startOfToday() } : undefined}
      showOutsideDays={false}
      components={{
        Chevron: ({ orientation }) => orientation === 'left'
          ? <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          : <ChevronRight className="h-4 w-4" aria-hidden="true" />,
      }}
      classNames={{
        root: 'relative w-fit text-ink',
        months: 'relative flex flex-col',
        month: 'flex flex-col gap-1',
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'text-[13px] font-semibold capitalize text-ink',
        nav: 'absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between',
        button_previous: NAV_BUTTON,
        button_next: NAV_BUTTON,
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday: 'flex h-7 w-9 items-center justify-center text-[11px] font-medium lowercase text-ink-faint',
        week: 'flex',
        day: 'p-0 text-center',
        day_button:
          'inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-plate)] text-[13px] tabular-nums text-ink transition-colors duration-[120ms] hover:bg-paper-sunk focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        today: '[&>button]:font-bold [&>button]:text-[var(--sg-accent)] [&>button]:underline [&>button]:underline-offset-4',
        selected:
          '[&>button]:bg-[var(--sg-accent)] [&>button]:font-semibold [&>button]:text-white! [&>button]:no-underline [&>button]:hover:bg-[var(--sg-accent-ink)]',
        disabled: '[&>button]:text-rule-strong',
        hidden: 'invisible',
      }}
    />
  )
}

/** Calendarul cu rândul de jos: „Azi” și, unde se poate, „Fără termen”. */
function CalendarPanel({
  value,
  onSelect,
  minToday,
  allowClear,
  onClear,
  saving,
}: {
  value: string | null | undefined
  onSelect: (day: string) => void
  minToday: boolean
  allowClear: boolean
  onClear?: () => void
  saving: boolean
}) {
  return (
    <>
      <div className={saving ? 'pointer-events-none opacity-60' : ''}>
        <Calendar selected={parseDay(value)} minToday={minToday} onSelect={date => onSelect(toDayString(date))} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-rule pt-2">
        <button data-tooltip="Termenul: azi"
          type="button"
          disabled={saving}
          onClick={() => onSelect(toDayString(startOfToday()))}
          className="inline-flex min-h-8 items-center rounded-[var(--radius-plate)] px-2 text-xs font-semibold text-[var(--sg-accent)] transition-colors duration-[120ms] hover:bg-[var(--sg-accent-soft)] disabled:opacity-50"
        >
          Azi
        </button>
        {saving ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Se salvează…
          </span>
        ) : allowClear && onClear ? (
          <button data-tooltip="Șterge termenul"
            type="button"
            onClick={onClear}
            className="inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-plate)] px-2 text-xs text-ink-soft transition-colors duration-[120ms] hover:bg-[var(--sg-danger-soft)] hover:text-[var(--sg-danger)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Fără termen
          </button>
        ) : null}
      </div>
    </>
  )
}

/**
 * Escape și clicul în afară închid calendarul. Escape se prinde pe `window`,
 * în faza de captură: ajunge înaintea ascultătorului dialogului Radix (pe
 * `document`), care altfel ar închide și dialogul în care stă calendarul.
 */
function useDismiss(
  open: boolean,
  inside: () => (HTMLElement | null)[],
  onClose: () => void,
  onEscape?: () => void,
) {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (inside().some(el => el?.contains(target))) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onClose()
      onEscape?.()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, inside, onClose, onEscape])
}

/** Unde plutește panoul: în dialogul care conține ancora, altfel în `body`. */
function floatingHost(anchor: HTMLElement | null): HTMLElement {
  return anchor?.closest<HTMLElement>('[role="dialog"]') ?? document.body
}

const PANEL_WIDTH = 284
const PANEL_HEIGHT = 360

/**
 * Calendarul care plutește lângă o ancoră. Alegerea unei zile salvează pe loc
 * (ca în monday), Escape sau un clic în afară renunță.
 *
 * Panoul se randează în dialogul care conține ancora, dacă există: un dialog
 * modal ar fi tratat un clic într-un panou din `body` drept clic în afară și
 * s-ar fi închis singur.
 */
export function DatePopover({
  anchorRef,
  value,
  onSelect,
  onClose,
  minToday = false,
  allowClear = false,
  onClear,
  saving = false,
  label = 'Termen limită',
}: {
  anchorRef: RefObject<HTMLElement | null>
  value: string | null | undefined
  onSelect: (day: string) => void
  onClose: () => void
  minToday?: boolean
  /** Arată „Fără termen” — doar unde ștergerea are sens și există ce șterge. */
  allowClear?: boolean
  onClear?: () => void
  saving?: boolean
  label?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [style, setStyle] = useState<React.CSSProperties | null>(null)

  const place = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const target = floatingHost(anchor)
    const r = anchor.getBoundingClientRect()
    const below = r.bottom + 4 + PANEL_HEIGHT <= window.innerHeight - 8 || r.top < PANEL_HEIGHT
    const viewportLeft = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8))
    const viewportTop = below ? r.bottom + 4 : r.top - 4 - PANEL_HEIGHT
    if (target === document.body) {
      setStyle({ position: 'fixed', left: viewportLeft, top: Math.max(8, viewportTop) })
    } else {
      // În dialog, coordonatele sunt ale dialogului: acela poate fi
      // transformat (centrat cu `translate`) și se poate derula.
      const c = target.getBoundingClientRect()
      setStyle({
        position: 'absolute',
        left: viewportLeft - c.left + target.scrollLeft,
        top: Math.max(8, viewportTop) - c.top + target.scrollTop,
      })
    }
    setHost(target)
  }, [anchorRef])

  useLayoutEffect(() => { place() }, [place])

  const inside = useCallback(() => [panelRef.current, anchorRef.current], [anchorRef])
  const refocus = useCallback(() => anchorRef.current?.focus(), [anchorRef])
  useDismiss(true, inside, onClose, refocus)

  useEffect(() => {
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [place])

  if (!host || !style) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      onClick={e => e.stopPropagation()}
      style={{ ...style, width: PANEL_WIDTH }}
      className="z-[1000000] rounded-[var(--radius-plate-lg)] border border-rule bg-plate p-3 shadow-[var(--sg-lift)]"
    >
      <CalendarPanel value={value} onSelect={onSelect} minToday={minToday} allowClear={allowClear} onClear={onClear} saving={saving} />
    </div>,
    host,
  )
}

/**
 * Câmpul de dată dintr-un formular: arată ca un câmp, iar calendarul se
 * deschide dedesubt, în formular — nu plutește. Formularele stau în dialoguri
 * care se derulează, iar un panou plutitor s-ar fi tăiat la marginea lor.
 * Valoarea e `YYYY-MM-DD` sau șir gol, ca la `<input type="date">`.
 */
export function DateField({
  id,
  value,
  onChange,
  placeholder = 'Alege o zi',
  minToday = false,
  allowClear = true,
  label = 'Termen limită',
  className = '',
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minToday?: boolean
  allowClear?: boolean
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const day = parseDay(value)
  const close = useCallback(() => setOpen(false), [])
  const inside = useCallback(() => [panelRef.current, buttonRef.current], [])
  const refocus = useCallback(() => buttonRef.current?.focus(), [])
  useDismiss(open, inside, close, refocus)
  return (
    <div>
      <button data-tooltip="Alege ziua din calendar"
        ref={buttonRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`flex h-11 w-full items-center gap-2 rounded-[var(--radius-plate)] border bg-plate px-3 text-left text-sm transition-colors duration-[120ms] hover:border-rule-strong ${
          open ? 'border-[var(--sg-accent)]' : 'border-rule'
        } ${className}`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
        <span className={day ? 'text-ink' : 'text-ink-faint'}>
          {day ? day.toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : placeholder}
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          className="mt-2 w-fit rounded-[var(--radius-plate-lg)] border border-rule bg-plate p-3"
        >
          <CalendarPanel
            value={value}
            minToday={minToday}
            allowClear={allowClear && !!value}
            onClear={() => { onChange(''); close(); refocus() }}
            onSelect={next => { onChange(next); close(); refocus() }}
            saving={false}
          />
        </div>
      )}
    </div>
  )
}
