'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarPlus, Check, Clock } from 'lucide-react'
import { DatePopover } from '@/components/ui/DatePicker'
import { TONE, deadlineSignal, type SignalTone } from '@/lib/signage'
import { profileDisplayName } from '@/lib/profile-display'
import { ToneIcon } from '@/components/ui/ToneIcon'
import { AssigneePicker, Initials, type Member } from './AssigneePicker'

export type { Member }

/**
 * Tabelul proiectului are două forme, după cât loc are, nu după ecran: lângă
 * panoul fazelor, pe un laptop, încape mai puțin decât pe același monitor cu
 * panoul strâns. Deci pragul e o interogare de container (`@container` pe
 * învelișul tabelului), de 50rem — suma minimă a coloanelor.
 *
 * Sub prag, fiecare rând e o fișă: numele sus, celulele dedesubt, pe rânduri.
 * Peste prag, celulele se aliniază pe coloane, ca în monday.
 */

/**
 * Celulă de tabel în forma lată: conținut centrat, fără linii verticale. Rândul
 * se citește pe orizontală; coloanele se țin aliniate singure, din grilă.
 */
export const CELL =
  '@min-[50rem]:flex @min-[50rem]:min-h-11 @min-[50rem]:items-center @min-[50rem]:justify-center'

/**
 * Ce înseamnă fiecare stare, pe înțelesul celui care se uită — tooltip-ul
 * etichetei. Aceeași etichetă înseamnă același lucru la activitate și la
 * cerere, deci ajunge un singur dicționar.
 */
const STATUS_HINTS: Record<string, string> = {
  'Finalizată': 'Activitatea e încheiată.',
  'Depășită': 'A trecut termenul activității sau al unei cereri din ea.',
  'Document respins': 'Un document a fost respins; clientul trebuie să-l încarce din nou.',
  'De verificat': 'Clientul a încărcat documente care așteaptă verificarea ta.',
  'La client': 'Se așteaptă documente de la client.',
  'Toate primite': 'Toate cererile sunt aprobate sau închise; activitatea se poate marca drept finalizată.',
  'În curs': 'Nicio cerere nu așteaptă ceva acum.',
  'De încărcat': 'Ai de încărcat un document aici.',
  'În verificare': 'Documentul încărcat e verificat de consultant.',
  'Așteaptă răspuns': 'Clientul n-a încărcat încă documentul cerut.',
  'Aprobat': 'Documentul a fost verificat și aprobat.',
  'Respins': 'Documentul a fost respins și trebuie încărcat din nou.',
  'Închisă': 'Cererea s-a încheiat și nu mai așteaptă nimic.',
}

/**
 * Eticheta de stare: o plăcuță mică în nuanța deschisă a semnalului, cu
 * iconița și cuvântul în culoarea lui (toate perechile trec de 4,6:1). Pe
 * coloane are o lățime fixă, ca etichetele să se alinieze una sub alta, ca
 * celulele din monday, fără greutatea unui bloc plin. Culoarea nu e singură:
 * iconița și cuvântul spun același lucru (WCAG 1.4.1).
 */
export function StatusCell({
  tone,
  label,
  className = '',
}: {
  tone: SignalTone
  label: string
  className?: string
}) {
  return (
    <span
      data-tooltip={STATUS_HINTS[label]}
      className={`inline-flex h-6 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-plate)] px-2 text-xs font-semibold leading-none @min-[50rem]:w-[8.75rem] ${className}`}
      style={{ background: TONE[tone].bg, color: TONE[tone].fg }}
    >
      <ToneIcon tone={tone} className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </span>
  )
}

/**
 * Câte cereri sunt gata din câte — doar cifra, cu bifă verde când sunt toate;
 * pentru cititoare, propoziția întreagă („2 din 5 cereri finalizate”).
 */
export function ProgressCell({ done, total, sentence }: { done: number; total: number; sentence: string }) {
  if (total === 0) {
    return (
      <span className="text-xs text-ink-faint">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Nicio cerere</span>
      </span>
    )
  }
  const complete = done === total
  return (
    <span className="inline-flex items-center gap-1 text-xs tabular-nums" title={sentence}>
      {complete && <Check className="h-3.5 w-3.5 text-[var(--sg-ok)]" strokeWidth={2.5} aria-hidden="true" />}
      <span aria-hidden="true" className={complete ? 'font-semibold text-[var(--sg-ok)]' : 'text-ink-soft'}>
        {done}<span className={complete ? '' : 'text-ink-faint'}>/{total}</span>
      </span>
      <span className="sr-only">{sentence}</span>
    </span>
  )
}

/** Data scurtă, cu anul doar când nu e anul curent: „13 oct”, „2 feb. 2027”. */
export function formatShortDate(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('ro-RO', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Termenul, scris ca dată, cu semn și culoare când arde: triunghi roșu dacă a
 * trecut, ceas chihlimbar în ultimele 7 zile. Cu `onSave`, celula se editează
 * pe loc; editorul plutește peste rând, ca să nu-l lărgească.
 */
export function DeadlineCell({
  value,
  done = false,
  onSave,
  itemName,
}: {
  value: string | null | undefined
  done?: boolean
  onSave?: (value: string) => Promise<void> | void
  /** Pentru numele accesibil al butonului: „Schimbă termenul pentru …”. */
  itemName: string
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const signal = deadlineSignal(value ?? null, done)
  const close = useCallback(() => { if (!saving) setEditing(false) }, [saving])
  const burning = !done && (signal.tone === 'danger' || signal.tone === 'warn')
  const color = done || !value
    ? 'var(--sg-ink-soft)'
    : signal.tone === 'danger' ? 'var(--sg-danger)' : signal.tone === 'warn' ? 'var(--sg-warn)' : 'var(--sg-ink-soft)'

  const save = async (next: string) => {
    if (!onSave) return
    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } catch {
      // motivul e deja pe ecran, ca toast; editorul rămâne deschis
    } finally {
      setSaving(false)
    }
  }

  const display: ReactNode = value ? (
    <span className={`inline-flex items-center gap-1 text-xs tabular-nums ${burning ? 'font-semibold' : ''}`} style={{ color }}>
      {burning && (signal.tone === 'danger'
        ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
        : <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />)}
      {formatShortDate(value)}
      {burning && <span className="sr-only"> — {signal.label.toLowerCase()}</span>}
    </span>
  ) : onSave ? (
    <CalendarPlus className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
  ) : (
    <span className="text-xs text-ink-faint">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Fără termen</span>
    </span>
  )

  return (
    <span className="inline-flex" onClick={e => e.stopPropagation()}>
      {onSave ? (
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={editing}
          onClick={() => setEditing(open => !open)}
          aria-label={value ? `Schimbă termenul pentru ${itemName}: ${formatShortDate(value)}` : `Adaugă termen pentru ${itemName}`}
          title={value ? signal.label : 'Adaugă termen limită'}
          className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-[var(--radius-plate)] px-2 transition-colors duration-[120ms] hover:bg-paper-sunk aria-expanded:bg-paper-sunk pointer-fine:min-h-7"
        >
          {display}
        </button>
      ) : (
        <span title={value ? signal.label : undefined} className="inline-flex items-center justify-center">
          {display}
        </span>
      )}
      {/* Calendarul plutește lângă celulă; o zi aleasă se salvează pe loc. */}
      {editing && onSave && (
        <DatePopover
          anchorRef={buttonRef}
          value={value ?? null}
          minToday={!value}
          saving={saving}
          onSelect={next => { void save(next) }}
          onClose={close}
          label={`Termen limită pentru ${itemName}`}
        />
      )}
    </span>
  )
}

/**
 * Responsabilul: plăcuța cu inițiale și numele. Cine poate atribui primește
 * alegătorul de persoane (`AssigneePicker`); ceilalți doar îl văd.
 */
export function AssigneeCell({
  assignedTo,
  assignedUser,
  members,
  canAssign,
  onAssign,
  label = 'Atribuie consultant',
}: {
  assignedTo: string | null | undefined
  assignedUser: Member | null | undefined
  members: Member[]
  canAssign: boolean
  onAssign: (id: string | null) => void
  label?: string
}) {
  if (canAssign) {
    return <AssigneePicker value={assignedTo} person={assignedUser} members={members} onChange={onAssign} label={label} />
  }
  const name = assignedTo ? profileDisplayName(assignedUser) : null
  return (
    <span className="inline-flex min-w-0 items-center gap-2 px-1.5 text-xs text-ink-soft" title={name ?? undefined}>
      <Initials name={assignedUser?.full_name} email={assignedUser?.email} muted={!assignedTo} />
      <span className={`min-w-0 truncate ${assignedTo ? '' : 'text-ink-faint'}`}>{name ?? 'Neatribuită'}</span>
    </span>
  )
}
