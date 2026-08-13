// Calendarul de termene (#69) — tipuri și aritmetică, fără nimic de randat.
//
// Fișierul e împărțit între server (`app/api/calendar`) și interfață
// (`components/calendar/*`), ca regulile să fie scrise o singură dată. Serverul
// decide *ce* elemente se văd; de aici mai jos se decide doar cum se citesc.

// Cale relativă, cu extensie: fișierul are teste rulate direct cu `node --test`
// (vezi `calendar.test.mjs`), iar Node nu cunoaște aliasul `@/` și cere
// specificatorul complet.
import { getDaysUntilDeadline } from './document-reminder.ts'

// ─── Tipuri ───────────────────────────────────────────────────────────────────

export type CalendarEventKind = 'activity' | 'request'
export type CalendarVisibility = 'draft' | 'published'

/**
 * Starea de progres a unui eveniment. „Depășit" înseamnă termen trecut *și*
 * element nefinalizat: un element terminat după termen rămâne terminat, altfel
 * tot istoricul proiectului ar apărea roșu. Cele trei se exclud reciproc.
 */
export type CalendarProgress = 'open' | 'done' | 'overdue'

export interface CalendarEvent {
  id: string
  kind: CalendarEventKind
  name: string
  /** `timestamptz` în bază, dar folosit ca dată calendaristică. Vezi `deadlineKey`. */
  deadline_at: string | null
  /** Activitate încheiată, respectiv cerere aprobată. Calculat pe server. */
  done: boolean
  visibility: CalendarVisibility
  project_id: string
  project_title: string
  client_name: string | null
  /** Null pentru cererile generale — vezi `GENERAL_PHASE_ID`. */
  phase_id: string | null
  phase_name: string | null
  /** Pe evenimentele de tip activitate, activitatea e chiar elementul. */
  activity_id: string | null
  activity_name: string | null
  /** Responsabilul efectiv: al elementului, cu revenire la cel al părintelui (#70). */
  assignee_id: string | null
  assignee_name: string | null
  /** Deep-link către elementul din pagina proiectului. */
  href: string
}

export interface CalendarProjectOption {
  id: string
  title: string
  client_name: string | null
}

export interface CalendarPhaseOption {
  id: string
  name: string
  order_index: number
}

export interface CalendarPayload {
  events: CalendarEvent[]
  projects: CalendarProjectOption[]
  phases: CalendarPhaseOption[]
  role: 'admin' | 'consultant' | 'client'
  user_id: string
}

// ─── Constante partajate ──────────────────────────────────────────────────────

/**
 * Cererile fără activitate stau, și în pagina proiectului, într-o secțiune
 * distinctă cu acest id. Aceeași valoare ajunge în `?phase=` din deep-link.
 */
export const GENERAL_PHASE_ID = '__general__'

/** Opțiunea „Fără responsabil" din filtrul de responsabil. */
export const UNASSIGNED_OWNER_ID = '__none__'

/** Un termen e „urgent" dacă e depășit sau cade în următoarele 7 zile. */
export const URGENT_WINDOW_DAYS = 7

// ─── Stare derivată ───────────────────────────────────────────────────────────

/**
 * Progresul unui eveniment, calculat în fusul utilizatorului. „Azi" se ia de
 * la `getDaysUntilDeadline`, aceeași funcție pe care o folosește cronul de
 * remindere (#71) — două aritmetici de date ar putea spune lucruri diferite
 * despre același termen.
 */
export function eventProgress(event: Pick<CalendarEvent, 'deadline_at' | 'done'>): CalendarProgress {
  if (event.done) return 'done'
  const days = getDaysUntilDeadline(event.deadline_at)
  return days !== null && days < 0 ? 'overdue' : 'open'
}

/**
 * Ce înseamnă „finalizat" pe fiecare sursă. Scris o singură dată, fiindcă îl
 * folosesc și ruta de calendar, și indicatorul numeric din pagina proiectului.
 */
export const isActivityDone = (row: { status?: string | null; completed_at?: string | null }): boolean =>
  row.status === 'completed' || !!row.completed_at

export const isRequestDone = (row: { status?: string | null }): boolean => row.status === 'approved'

/**
 * Responsabilul efectiv al unei cereri: al ei, cu revenire la consultantul
 * activității-părinte și, pentru cererile generale, la consultantul de proiect
 * — exact lanțul din regula de publicare (#70).
 *
 * Îl folosesc și ruta de calendar, și indicatorul numeric din pagina
 * proiectului: dacă badge-ul ar număra altfel decât filtrează calendarul,
 * consultantul ar vedea un „7" roșu care deschide o vedere goală.
 */
export function requestOwnerId(request: {
  assigned_to?: string | null
  activity_id?: string | null
  activity?: { assigned_to?: string | null } | null
  generalOwnerId?: string | null
}): string | null {
  if (request.assigned_to) return request.assigned_to
  if (request.activity?.assigned_to) return request.activity.assigned_to
  if (!request.activity_id) return request.generalOwnerId ?? null
  return null
}

/**
 * Termen care cere atenție acum: depășit sau în următoarele 7 zile, pe un
 * element nefinalizat. Sursa indicatorului numeric de pe tabul „Calendar".
 */
export function isUrgentDeadline(deadlineAt: string | null, done = false): boolean {
  if (done) return false
  const days = getDaysUntilDeadline(deadlineAt)
  return days !== null && days <= URGENT_WINDOW_DAYS
}

export const PROGRESS_LABELS: Record<CalendarProgress, string> = {
  open: 'În lucru',
  done: 'Finalizat',
  overdue: 'Depășit',
}

export const VISIBILITY_LABELS: Record<CalendarVisibility, string> = {
  draft: 'În pregătire',
  published: 'Publicat',
}

export const KIND_LABELS: Record<CalendarEventKind, string> = {
  activity: 'Activitate',
  request: 'Cerere',
}

// ─── Date calendaristice ──────────────────────────────────────────────────────

/**
 * Cheia de zi a unei date, în fusul utilizatorului. `toISOString` ar da ziua în
 * UTC, deci o parte din fiecare zi ar cădea într-o celulă greșită a grilei.
 */
export function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Ziua în care cade un termen. Null dacă nu există termen sau e nevalid. */
export function deadlineKey(deadlineAt: string | null): string | null {
  if (!deadlineAt) return null
  const date = new Date(deadlineAt)
  return Number.isNaN(date.getTime()) ? null : dateKey(date)
}

/** Luna unei date, ca „YYYY-MM" — forma din URL. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function parseMonthKey(value: string | null): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  if (month < 0 || month > 11) return null
  return new Date(year, month, 1)
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

/** Luni-first, ca în calendarul românesc. */
export const WEEKDAY_LABELS = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du']

/**
 * Cele 42 de zile ale grilei de lună: luna cerută, plus zilele din lunile
 * vecine care completează primele și ultima săptămână. Șase săptămâni fixe, ca
 * grila să nu-și schimbe înălțimea de la o lună la alta.
 */
export function monthGridDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  // getDay(): 0 = duminică. Luni-first înseamnă 0 = luni, 6 = duminică.
  const leading = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - leading)
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
  )
}

export function formatMonthTitle(month: Date): string {
  return month.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
}

export function formatDayTitle(date: Date): string {
  return date.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatShortDate(deadlineAt: string): string {
  return new Date(deadlineAt).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** „mâine", „în 3 zile", „acum 2 zile" — contextul de lângă dată. */
export function formatRelativeDeadline(deadlineAt: string | null): string | null {
  const days = getDaysUntilDeadline(deadlineAt)
  if (days === null) return null
  if (days === 0) return 'astăzi'
  if (days === 1) return 'mâine'
  if (days === -1) return 'ieri'
  if (days > 0) return `în ${days} zile`
  return `acum ${Math.abs(days)} zile`
}

// ─── Filtre ───────────────────────────────────────────────────────────────────

/**
 * `null` înseamnă „toate" pe fiecare dimensiune multi-select: fără filtru, nu
 * listă goală. Lista goală e o stare validă și distinctă — utilizatorul a scos
 * toate opțiunile și nu vede nimic.
 */
export interface CalendarFilterState {
  kinds: CalendarEventKind[]
  /** Id-uri de fază, plus `GENERAL_PHASE_ID` pentru cererile fără activitate. */
  phaseIds: string[] | null
  projectIds: string[] | null
  progress: CalendarProgress[] | null
  visibility: CalendarVisibility[] | null
  /** Id-uri de responsabil, plus `UNASSIGNED_OWNER_ID`. */
  owners: string[] | null
}

/**
 * Implicit per rol: consultantul pornește de la ce îi este atribuit, ceilalți
 * de la tot ce le e accesibil.
 */
export function defaultFilters(role: CalendarPayload['role'], userId: string): CalendarFilterState {
  return {
    kinds: ['activity', 'request'],
    phaseIds: null,
    projectIds: null,
    progress: null,
    visibility: null,
    owners: role === 'consultant' ? [userId] : null,
  }
}

function matchesSelection(value: string | null, selection: string[] | null, nullToken: string): boolean {
  if (selection === null) return true
  return selection.includes(value ?? nullToken)
}

export function filterEvents(events: CalendarEvent[], filters: CalendarFilterState): CalendarEvent[] {
  return events.filter(event => {
    if (!filters.kinds.includes(event.kind)) return false
    if (!matchesSelection(event.phase_id, filters.phaseIds, GENERAL_PHASE_ID)) return false
    if (filters.projectIds !== null && !filters.projectIds.includes(event.project_id)) return false
    if (filters.progress !== null && !filters.progress.includes(eventProgress(event))) return false
    if (filters.visibility !== null && !filters.visibility.includes(event.visibility)) return false
    if (!matchesSelection(event.assignee_id, filters.owners, UNASSIGNED_OWNER_ID)) return false
    return true
  })
}

/** Câte controale sunt duse în afara stării implicite — pentru „Șterge filtrele". */
export function activeFilterCount(filters: CalendarFilterState, defaults: CalendarFilterState): number {
  return [
    [filters.kinds, defaults.kinds],
    [filters.phaseIds, defaults.phaseIds],
    [filters.projectIds, defaults.projectIds],
    [filters.progress, defaults.progress],
    [filters.visibility, defaults.visibility],
    [filters.owners, defaults.owners],
  ].filter(([value, fallback]) => !sameSelection(value, fallback)).length
}

// ─── Filtre în URL ────────────────────────────────────────────────────────────
//
// Prefixul `c` ține parametrii calendarului separați de `phase`/`activity`/
// `document`, pe care pagina proiectului le folosește deja pentru deep-link.

const PARAM = {
  view: 'cv',
  month: 'cm',
  kinds: 'ck',
  phases: 'cp',
  projects: 'cj',
  progress: 'cs',
  visibility: 'cb',
  owners: 'co',
} as const

export type CalendarViewMode = 'month' | 'list'

// Trei stări de codificat, nu două: „toate" (fără filtru), „niciuna" (toate
// opțiunile scoase) și o listă explicită. Un șir gol le-ar confunda pe primele
// două, așa că fiecare are token propriu.
const ALL_TOKEN = '*'
const NONE_TOKEN = '-'

/** `undefined` = parametrul lipsește din URL, deci rămâne valoarea implicită. */
function parseSelection(value: string | null): string[] | null | undefined {
  if (value === null) return undefined
  if (value === ALL_TOKEN) return null
  if (value === NONE_TOKEN) return []
  return value.split(',').map(v => v.trim()).filter(Boolean)
}

function serializeSelection(value: string[] | null): string {
  if (value === null) return ALL_TOKEN
  if (value.length === 0) return NONE_TOKEN
  return value.join(',')
}

function sameSelection(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every(v => b.includes(v))
}

function keepKnown<T extends string>(values: string[], known: readonly T[]): T[] {
  return values.filter((v): v is T => (known as readonly string[]).includes(v))
}

function readKnown<T extends string>(
  raw: string[] | null | undefined,
  known: readonly T[],
  fallback: T[] | null,
): T[] | null {
  if (raw === undefined) return fallback
  if (raw === null) return null
  return keepKnown(raw, known)
}

export function readFiltersFromParams(
  params: URLSearchParams,
  fallback: CalendarFilterState,
): CalendarFilterState {
  const rawKinds = parseSelection(params.get(PARAM.kinds))
  const rawPhases = parseSelection(params.get(PARAM.phases))
  const rawProjects = parseSelection(params.get(PARAM.projects))
  const rawOwners = parseSelection(params.get(PARAM.owners))

  return {
    // Tipul de element n-are stare „toate" separată: ambele comutatoare pornite
    // *sunt* toate, deci `*` și lista completă înseamnă același lucru.
    kinds: rawKinds === undefined
      ? fallback.kinds
      : rawKinds === null
      ? ['activity', 'request']
      : keepKnown(rawKinds, ['activity', 'request'] as const),
    phaseIds: rawPhases === undefined ? fallback.phaseIds : rawPhases,
    projectIds: rawProjects === undefined ? fallback.projectIds : rawProjects,
    progress: readKnown(
      parseSelection(params.get(PARAM.progress)),
      ['open', 'done', 'overdue'] as const,
      fallback.progress,
    ),
    visibility: readKnown(
      parseSelection(params.get(PARAM.visibility)),
      ['draft', 'published'] as const,
      fallback.visibility,
    ),
    owners: rawOwners === undefined ? fallback.owners : rawOwners,
  }
}

/**
 * Scrie în `params` doar ce se abate de la starea implicită: un URL fără
 * parametri de calendar rămâne curat, iar unul filtrat se poate trimite mai
 * departe și se redeschide identic.
 */
export function writeFiltersToParams(
  params: URLSearchParams,
  filters: CalendarFilterState,
  defaults: CalendarFilterState,
): void {
  const put = (key: string, value: string[] | null, fallbackValue: string[] | null) => {
    if (sameSelection(value, fallbackValue)) params.delete(key)
    else params.set(key, serializeSelection(value))
  }

  put(PARAM.kinds, filters.kinds, defaults.kinds)
  put(PARAM.phases, filters.phaseIds, defaults.phaseIds)
  put(PARAM.projects, filters.projectIds, defaults.projectIds)
  put(PARAM.progress, filters.progress, defaults.progress)
  put(PARAM.visibility, filters.visibility, defaults.visibility)
  put(PARAM.owners, filters.owners, defaults.owners)
}

/**
 * Scoate din URL tot ce ține de calendar. Folosit când pagina proiectului
 * părăsește tabul: filtrele lui n-au ce căuta pe un link către faze.
 */
export function clearCalendarParams(params: URLSearchParams): void {
  for (const key of Object.values(PARAM)) params.delete(key)
}

export function readViewMode(params: URLSearchParams): CalendarViewMode {
  return params.get(PARAM.view) === 'list' ? 'list' : 'month'
}

export function writeViewMode(params: URLSearchParams, mode: CalendarViewMode): void {
  if (mode === 'month') params.delete(PARAM.view)
  else params.set(PARAM.view, mode)
}

export function readMonth(params: URLSearchParams): Date {
  const parsed = parseMonthKey(params.get(PARAM.month))
  if (parsed) return parsed
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

export function writeMonth(params: URLSearchParams, month: Date): void {
  const now = new Date()
  const isCurrentMonth = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth()
  if (isCurrentMonth) params.delete(PARAM.month)
  else params.set(PARAM.month, monthKey(month))
}
