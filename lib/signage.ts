/**
 * Programul de semnalizare — regulile care nu au voie să difere de la un ecran
 * la altul. Ce e aici e adevărul; nicio pagină nu-și inventează propria bandă
 * sau propriul cuvânt de stare.
 */

/** Cele șase benzi de fază, fixe și ordonate. */
export const BAND_COUNT = 6

/**
 * Banda unei faze. Aceeași fază primește aceeași bandă oriunde apare — în
 * sidebar, în calendar, pe dosarul din Drive, în notificare.
 *
 * Cheia preferată e **poziția fazei în proiect**, ca într-un program de
 * semnalizare adevărat, unde culorile aripilor sunt poziționale: rotația pe
 * șase dă distribuție egală și garantează că două faze vecine nu poartă
 * niciodată aceeași culoare. Un hash pe id ar fi context-independent, dar
 * măsurat pe 14 faze dă în medie 2,3 perechi de vecini identici și o
 * distribuție strâmbă — exact ce strică teza.
 *
 * Varianta pe șir rămâne pentru suprafețele care n-au poziția la îndemână.
 */
export function bandFor(key: string | number | null | undefined): number {
  if (key === null || key === undefined) return 6
  if (typeof key === 'number') return ((Math.abs(Math.trunc(key)) % BAND_COUNT) + 1)
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return (h % BAND_COUNT) + 1
}

/** Culoarea benzii, ca variabilă CSS — de folosit în `style`, nu în clase. */
export function bandVar(band: number): string {
  return `var(--sg-band-${band})`
}
export function bandSoftVar(band: number): string {
  return `var(--sg-band-${band}-soft)`
}

/**
 * Vocabularul de stări. Fiecare stare are culoare, iconiță (`ToneIcon`) și
 * cuvânt — culoarea nu poartă niciodată singură informația (WCAG 1.4.1).
 */
export type SignalTone = 'ok' | 'warn' | 'danger' | 'draft' | 'neutral'

export const TONE: Record<SignalTone, { fg: string; bg: string }> = {
  ok:      { fg: 'var(--sg-ok)',       bg: 'var(--sg-ok-soft)' },
  warn:    { fg: 'var(--sg-warn)',     bg: 'var(--sg-warn-soft)' },
  danger:  { fg: 'var(--sg-danger)',   bg: 'var(--sg-danger-soft)' },
  draft:   { fg: 'var(--sg-draft)',    bg: 'var(--sg-draft-soft)' },
  neutral: { fg: 'var(--sg-ink-soft)', bg: 'var(--sg-paper-sunk)' },
}

/**
 * Cât mai e până la un termen, spus în cuvintele produsului, plus tonul care i
 * se cuvine. Un termen nu e niciodată doar o culoare.
 */
export function deadlineSignal(
  due: string | Date | null | undefined,
  done = false,
): { tone: SignalTone; label: string; days: number | null } {
  if (done) return { tone: 'ok', label: 'Finalizat', days: null }
  if (!due) return { tone: 'neutral', label: 'Fără termen', days: null }

  const d = typeof due === 'string' ? new Date(due) : due
  if (Number.isNaN(d.getTime())) return { tone: 'neutral', label: 'Fără termen', days: null }

  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const days = Math.round(
    (startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86_400_000,
  )

  if (days < 0) {
    const n = Math.abs(days)
    return { tone: 'danger', label: n === 1 ? 'Depășit cu o zi' : `Depășit cu ${n} zile`, days }
  }
  if (days === 0) return { tone: 'warn', label: 'Astăzi', days }
  if (days === 1) return { tone: 'warn', label: 'Mâine', days }
  if (days <= 7) return { tone: 'warn', label: `În ${days} zile`, days }
  return { tone: 'neutral', label: `În ${days} zile`, days }
}

/** Data, în forma pe care o citește un om, cu cifre care se aliniază. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
}
