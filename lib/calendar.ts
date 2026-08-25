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
  /**
   * Statusul din bază, neinterpretat. `done` îl colapsează la da/nu, ceea ce
   * ajunge pentru calendar, dar șterge singura distincție care contează în
   * tabloul de bord: o cerere în verificare așteaptă echipa, una în așteptare
   * așteaptă clientul. Vezi `eventWaitingOn`.
   */
  status: string | null
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
  /**
   * `text` liber în bază, fără enum și fără nicio folosință în cod până la #81.
   * De aceea nu-l îngustăm la o listă de valori pe care n-o putem verifica:
   * singura pe care se sprijină ceva e `active` — vezi `isProjectActive`.
   */
  lifecycle_status: string
  /** Comutatorul din #85. Vezi `ProjectDashboardRow.reminders_off`. */
  automatic_reminders_enabled: boolean
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
 * PostgREST întoarce relațiile many-to-one când ca obiect, când ca listă, în
 * funcție de cum a fost cerută relația. Aici, fiindcă aceleași rânduri ajung și
 * pe ruta de calendar, și în pagina proiectului, prin interogări diferite.
 */
export const one = <T,>(relation: T | T[] | null | undefined): T | null =>
  (Array.isArray(relation) ? relation[0] : relation) ?? null

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

export type CalendarWaitingOn = 'us' | 'client'

export const WAITING_LABELS: Record<CalendarWaitingOn, string> = {
  us: 'la noi',
  client: 'la client',
}

/**
 * Cine trebuie să miște elementul mai departe; `null` pentru ce e finalizat.
 *
 * Regula nu e inventată aici: e chiar cea după care pagina proiectului împarte
 * panoul „Ce ai de făcut" — clientul are de lucru la `pending` și `rejected`,
 * consultantul la `review`. Activitățile sunt muncă internă, deci una
 * nefinalizată e mereu la noi, indiferent de status.
 *
 * Gardă pe egalitate cu `review`, nu pe lista celorlalte stări: `status` e
 * `text` liber în bază, iar o valoare nouă apărută acolo trebuie să cadă în „la
 * client", nu să fie numărată tăcut ca muncă a echipei. Aceeași alegere ca la
 * `isProjectActive`.
 */
export function eventWaitingOn(
  event: Pick<CalendarEvent, 'kind' | 'status' | 'done'>,
): CalendarWaitingOn | null {
  if (event.done) return null
  if (event.kind === 'activity') return 'us'
  return event.status === 'review' ? 'us' : 'client'
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
 *
 * De aceea activitatea-părinte se normalizează aici, nu la apelanți: cele două
 * o primesc din interogări diferite, iar `one` la un singur apelant ar fi
 * însemnat exact divergența pe care funcția există s-o împiedice.
 */
type ActivityOwner = { assigned_to?: string | null }

export function requestOwnerId(request: {
  assigned_to?: string | null
  activity_id?: string | null
  activity?: ActivityOwner | ActivityOwner[] | null
  generalOwnerId?: string | null
}): string | null {
  if (request.assigned_to) return request.assigned_to
  const activity = one(request.activity)
  if (activity?.assigned_to) return activity.assigned_to
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

/**
 * Fereastra de ani acceptată din URL. Constructorul `Date` cu doi parametri
 * rescrie anii 0–99 ca 1900–1999, deci `?cm=0026-08` ar fi randat „august
 * 1926" și s-ar fi întors în URL ca `1926-08`. Orice an în afara ferestrei e
 * URL stricat, nu o lună de arătat: se cade pe luna curentă.
 */
const MIN_YEAR = 1970
const MAX_YEAR = 2999

export function parseMonthKey(value: string | null): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  if (month < 0 || month > 11) return null
  if (year < MIN_YEAR || year > MAX_YEAR) return null
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

/**
 * „mâine", „în 3 zile", „în 128 de zile", „acum 2 zile" — contextul de lângă
 * dată. Numeralul trece prin `countLabel`, altfel scria „în 128 zile".
 */
export function formatRelativeDeadline(deadlineAt: string | null): string | null {
  const days = getDaysUntilDeadline(deadlineAt)
  if (days === null) return null
  if (days === 0) return 'astăzi'
  if (days === 1) return 'mâine'
  if (days === -1) return 'ieri'
  if (days > 0) return `în ${countLabel(days, 'zi', 'zile')}`
  return `acum ${countLabel(Math.abs(days), 'zi', 'zile')}`
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

// ─── Tablou de bord admin (#81) ───────────────────────────────────────────────
//
// Ecranul `/admin/proiecte` nu-și aduce datele lui: agregă evenimentele pe care
// `/api/calendar` le întoarce oricum. Numărătoarea stă aici, lângă `eventProgress`,
// tocmai ca să nu poată devia de la calendar — un proiect trebuie să arate același
// raport în ambele locuri.
//
// La 7 proiecte agregarea în client e gratuită. Dacă platforma ajunge la ordinul
// sutelor, funcțiile de mai jos sunt exact ce se mută pe server: primesc un
// `CalendarPayload` și nu ating nici React, nici URL-ul.

/**
 * Proiect „în lucru". Gardă pe egalitate cu `active`, nu pe o listă de valori
 * încheiate: `lifecycle_status` e `text` liber în bază, fără enum, deci o valoare
 * nouă apărută acolo trebuie să cadă în „încheiat" și să se ascundă implicit, nu
 * să se strecoare tăcut în lista pe care adminul o crede curentă.
 */
export const isProjectActive = (project: Pick<CalendarProjectOption, 'lifecycle_status'>): boolean =>
  project.lifecycle_status === 'active'

/**
 * Numerele unui rând de tablou, oricare ar fi capul lui de rând.
 *
 * Aceleași pentru un proiect și pentru un consultant: câtă muncă, cât e gata, cât e
 * depășit, ce urmează, cât nu e planificat. Scrise o singură dată fiindcă cele
 * două tabele stau pe același ecran — dacă „depășit" ar fi însemnat altceva de
 * la un tabel la altul, ecranul s-ar fi contrazis singur, la vedere.
 */
export interface DashboardTotals {
  /** Elementele numărate: activități și cereri de documente la un loc. */
  total: number
  done: number
  overdue: number
  /** Cel mai apropiat termen viitor al unui element nefinalizat. */
  next_deadline: string | null
  /**
   * De câte zile e depășit cel mai vechi termen. Numărul singur nu spune cât de
   * rău e: trei depășiri de o zi și trei de patru luni arătau identic.
   */
  oldest_overdue_days: number | null
  /**
   * Termene nefinalizate în următoarele `URGENT_WINDOW_DAYS` zile, azi inclusiv.
   * Depășitele nu intră — au coloana lor, și le-ar număra de două ori. De aceea
   * nu folosește `isUrgentDeadline`, care le cuprinde pe amândouă.
   */
  due_soon: number
  /**
   * Elemente nefinalizate care n-au niciun termen.
   *
   * Fără numărul ăsta, toate celelalte coloane de termene mint prin omisiune: un
   * proiect cu un singur element datat și șaptezeci nedatate arată la fel de
   * calm ca unul planificat cap-coadă. Azi, în bază, 16 elemente din 274 au
   * termen — deci coloanele descriu 6% din muncă, iar restul e tăcere.
   */
  undated: number
  /** Nefinalizate care așteaptă echipa, respectiv clientul. Împreună: `total - done`. */
  waiting_us: number
  waiting_client: number
  /** Nefinalizate pe care clientul nu le vede încă. */
  drafts: number
  /**
   * Aceleași numere, separate pe sursă. Raportul general e dominat de cereri
   * (azi peste 200, față de câteva zeci de activități), deci un „2/36" nu spune
   * singur dacă munca internă a avansat sau doar au intrat documente.
   */
  activities: { done: number; total: number }
  requests: { done: number; total: number }
  /** Depășitele, cele mai vechi întâi — pentru rândul desfășurat. */
  overdue_events: CalendarEvent[]
  /** Termenele care urmează, cel mai apropiat întâi. */
  upcoming_events: CalendarEvent[]
}

export interface ProjectDashboardRow extends DashboardTotals {
  id: string
  /** Capul de rând, sub numele pe care îl sortează ambele tabele. */
  label: string
  client_name: string | null
  active: boolean
  /**
   * Proiect cu reminderele automate oprite (#85).
   *
   * Se ține pe negativ fiindcă doar starea oprită se arată: un proiect care nu
   * mai trimite nimic automat își ține termenele din memoria cuiva, iar tabloul
   * răspunde tocmai la „cum stă fiecare proiect".
   *
   * Gardă pe `=== false`, oglinda celei din `lib/automatic-reminders` și din
   * cronul de remindere: necunoscutul înseamnă pornit, nu oprit tăcut.
   */
  reminders_off: boolean
}

export interface ConsultantDashboardRow extends DashboardTotals {
  /** Id-ul responsabilului, sau `UNASSIGNED_OWNER_ID` pentru munca fără nimeni. */
  id: string
  label: string
  /** Fals doar pe rândul „Fără responsabil". */
  assigned: boolean
  /** În câte proiecte are de lucru: un consultant întins pe cinci proiecte nu e ca unul pe unul. */
  projects: number
}

const byDeadlineAsc = (a: CalendarEvent, b: CalendarEvent) =>
  new Date(a.deadline_at ?? 0).getTime() - new Date(b.deadline_at ?? 0).getTime()

const emptyTotals = (): DashboardTotals => ({
  total: 0,
  done: 0,
  overdue: 0,
  next_deadline: null,
  oldest_overdue_days: null,
  due_soon: 0,
  undated: 0,
  waiting_us: 0,
  waiting_client: 0,
  drafts: 0,
  activities: { done: 0, total: 0 },
  requests: { done: 0, total: 0 },
  overdue_events: [],
  upcoming_events: [],
})

/**
 * Un element, adăugat la numerele unui rând.
 *
 * Nu-și definește propriul „finalizat" și propriul „depășit": le ia din
 * `eventProgress`, care le ia la rândul lui din `event.done` calculat pe server.
 * Două definiții paralele ar fi însemnat exact divergența pe care criteriul de
 * acceptare o interzice.
 */
function addEvent(totals: DashboardTotals, event: CalendarEvent): void {
  totals.total += 1
  const bucket = event.kind === 'activity' ? totals.activities : totals.requests
  bucket.total += 1

  const progress = eventProgress(event)
  if (progress === 'done') {
    totals.done += 1
    bucket.done += 1
    return
  }

  // De aici încolo, doar munca rămasă: „în pregătire" și „la cine e mingea"
  // n-au înțeles pe un element terminat.
  if (event.visibility === 'draft') totals.drafts += 1
  if (eventWaitingOn(event) === 'us') totals.waiting_us += 1
  else totals.waiting_client += 1

  if (progress === 'overdue') totals.overdue_events.push(event)
  // `open` cu termen: nici finalizat, nici trecut — deci chiar un termen
  // viitor, azi inclusiv.
  else if (event.deadline_at) totals.upcoming_events.push(event)
  // `open` fără termen: muncă rămasă pe care n-o așteaptă nicio dată.
  else totals.undated += 1
}

/** Ce se poate ști abia după ce au trecut toate elementele. */
function finalizeTotals(totals: DashboardTotals): void {
  // Ordinea listelor e cea în care se citesc în rândul desfășurat: cea mai
  // veche depășire prima, fiindcă e cea care doare, și cel mai apropiat termen
  // primul, fiindcă e următorul de rezolvat.
  totals.overdue_events.sort(byDeadlineAsc)
  totals.upcoming_events.sort(byDeadlineAsc)

  totals.overdue = totals.overdue_events.length
  totals.next_deadline = totals.upcoming_events[0]?.deadline_at ?? null

  const oldest = totals.overdue_events[0]
  const days = oldest ? getDaysUntilDeadline(oldest.deadline_at) : null
  totals.oldest_overdue_days = days === null ? null : Math.abs(days)

  totals.due_soon = totals.upcoming_events.filter(event => {
    const until = getDaysUntilDeadline(event.deadline_at)
    return until !== null && until <= URGENT_WINDOW_DAYS
  }).length
}

/**
 * Proiectele cu numerele lor, dintr-o singură trecere peste evenimentele deja
 * aduse pentru calendar.
 *
 * Proiectele vin din `payload.projects`, interogat din tabela `projects`, nu
 * dedus din evenimente — de aceea un proiect fără niciun element rămâne în listă
 * cu `total` 0, în loc să dispară din tabel.
 *
 * Tot aici se pregătesc și listele din rândul desfășurat: aceleași evenimente,
 * sortate o singură dată, nu la fiecare deschidere de rând.
 */
export function buildProjectDashboardRows(payload: CalendarPayload): ProjectDashboardRow[] {
  const rows = new Map<string, ProjectDashboardRow>(
    payload.projects.map(project => [
      project.id,
      {
        id: project.id,
        label: project.title,
        client_name: project.client_name,
        active: isProjectActive(project),
        reminders_off: project.automatic_reminders_enabled === false,
        ...emptyTotals(),
      },
    ])
  )

  for (const event of payload.events) {
    // Un eveniment fără proiect în listă n-ar trebui să existe: ambele vin din
    // aceeași cerere, restrânse la aceleași `projectIds`.
    const row = rows.get(event.project_id)
    if (row) addEvent(row, event)
  }

  for (const row of rows.values()) finalizeTotals(row)
  return [...rows.values()]
}

/**
 * Aceleași evenimente, adunate pe consultanți în loc de proiecte.
 *
 * Al doilea tabel al ecranului răspunde la „cine e blocat și cine e liber", iar
 * răspunsul iese din date deja descărcate: fiecare termen poartă responsabilul
 * lui efectiv, calculat pe server pe lanțul cerere → activitate → proiect
 * (`requestOwnerId`). Nicio cerere nouă, nicio a doua definiție a muncii.
 *
 * Rândurile ies din evenimente, nu dintr-o listă de consultanți: cine n-are
 * nimic atribuit nu apare. Munca fără nimeni în spate se strânge într-un rând
 * propriu, `UNASSIGNED_OWNER_ID` — azi cel mai încărcat dintre toate, și tocmai
 * de aceea nu e de ascuns.
 *
 * `projectIds` restrânge la proiectele vizibile în tabelul de alături, ca cele
 * două tabele să nu descrie mulțimi diferite când comutatorul de proiecte
 * încheiate e oprit.
 */
export function buildConsultantDashboardRows(
  payload: CalendarPayload,
  projectIds?: Set<string>,
): ConsultantDashboardRow[] {
  const rows = new Map<string, ConsultantDashboardRow>()
  const projectsOf = new Map<string, Set<string>>()

  for (const event of payload.events) {
    if (projectIds && !projectIds.has(event.project_id)) continue

    const id = event.assignee_id ?? UNASSIGNED_OWNER_ID
    let row = rows.get(id)
    if (!row) {
      row = {
        id,
        label: event.assignee_name ?? 'Fără responsabil',
        assigned: event.assignee_id !== null,
        projects: 0,
        ...emptyTotals(),
      }
      rows.set(id, row)
      projectsOf.set(id, new Set())
    }

    projectsOf.get(id)!.add(event.project_id)
    addEvent(row, event)
  }

  for (const row of rows.values()) {
    row.projects = projectsOf.get(row.id)!.size
    finalizeTotals(row)
  }
  return [...rows.values()]
}

export interface DashboardSummary {
  rows: number
  overdue: number
  /** În câte rânduri stau depășirile: „12 în 3 proiecte" e altă problemă decât „12 într-unul". */
  rowsWithOverdue: number
  dueSoon: number
  waitingUs: number
}

/**
 * Cifrele de deasupra tabelului, calculate peste exact rândurile vizibile — cu
 * proiectele încheiate ascunse și cu căutarea aplicată, altfel linia ar descrie
 * altceva decât tabelul de sub ea.
 *
 * O singură linie, nu un rând de indicatori mari: Home răspunde deja la „ce
 * necesită atenție acum", iar două ecrane cu aceleași cifre mari ar începe să se
 * contrazică de îndată ce ar diverge o definiție.
 */
export function summarizeRows(rows: DashboardTotals[]): DashboardSummary {
  return rows.reduce<DashboardSummary>(
    (total, row) => ({
      rows: total.rows + 1,
      overdue: total.overdue + row.overdue,
      rowsWithOverdue: total.rowsWithOverdue + (row.overdue > 0 ? 1 : 0),
      dueSoon: total.dueSoon + row.due_soon,
      waitingUs: total.waitingUs + row.waiting_us,
    }),
    { rows: 0, overdue: 0, rowsWithOverdue: 0, dueSoon: 0, waitingUs: 0 }
  )
}

/**
 * Numeralul românesc cere „de" peste 20, dar nu la 101–119: „3 termene", „21 de
 * termene", „118 termene". Fără regula asta, linia de rezumat ar fi scris „21
 * termene" de fiecare dată când platforma crește.
 */
export function countLabel(count: number, singular: string, plural: string): string {
  if (count === 1) return `1 ${singular}`
  const lastTwo = Math.abs(count) % 100
  const needsDe = Math.abs(count) >= 20 && !(lastTwo >= 1 && lastTwo <= 19)
  return `${count} ${needsDe ? 'de ' : ''}${plural}`
}

// ─── Sortarea tabelelor ───────────────────────────────────────────────────────
//
// Două tabele pe același ecran, cu aceeași mecanică: prima apăsare scoate în
// față problemele, a doua inversează, a treia revine la ordinea implicită, iar
// rândurile fără valoare stau la final în ambele sensuri. Regulile comune sunt
// scrise o dată, iar fiecare tabel aduce doar coloanele lui.

export type ProjectColumnKey = 'project' | 'client' | 'done' | 'waiting' | 'deadline' | 'overdue'
export type ConsultantColumnKey = 'consultant' | 'projects' | 'waiting' | 'deadline' | 'overdue'
/** `urgency` e ordinea implicită, nu o coloană: nu are antet și nu se inversează. */
export type ProjectSortKey = 'urgency' | ProjectColumnKey
export type ConsultantSortKey = 'urgency' | ConsultantColumnKey
export type SortDirection = 'asc' | 'desc'

const PROJECT_COLUMN_KEYS = ['project', 'client', 'done', 'waiting', 'deadline', 'overdue'] as const
const CONSULTANT_COLUMN_KEYS = ['consultant', 'projects', 'waiting', 'deadline', 'overdue'] as const

/** Rând de tablou, oricare din cele două tabele. */
type Row = DashboardTotals & { label: string }

interface ColumnSpec<T extends Row, K extends string> {
  keys: readonly K[]
  /**
   * Sensul primei apăsări. Regula e aceeași peste tot: prima apăsare scoate în
   * față problemele — cel mai puțin avansat, termenul cel mai apropiat, cele mai
   * multe depășiri — fiindcă ăsta e motivul pentru care cineva sortează tabelul.
   */
  first: Record<K, SortDirection>
  /**
   * Are coloana o valoare de comparat pentru rândul ăsta? Un `0` e valoare; un
   * client lipsă, un termen inexistent și un rând fără niciun element nu sunt.
   */
  hasValue: Record<K, (row: T) => boolean>
  /** Comparatoarele descriu doar sensul crescător; direcția se aplică deasupra. */
  compare: Record<K, (a: T, b: T) => number>
}

const byLabel = (a: Row, b: Row) => a.label.localeCompare(b.label, 'ro')

/** Comparatoarele care nu depind de capul de rând, deci merg în ambele tabele. */
const TOTALS_COMPARE = {
  // Întâi câtă muncă e la noi — singura pe care adminul o poate mișca azi —,
  // apoi cât așteaptă la client.
  waiting: (a: Row, b: Row) => a.waiting_us - b.waiting_us || a.waiting_client - b.waiting_client,
  deadline: (a: Row, b: Row) =>
    new Date(a.next_deadline!).getTime() - new Date(b.next_deadline!).getTime(),
  // La număr egal de depășiri, cea mai veche cântărește mai greu.
  overdue: (a: Row, b: Row) =>
    a.overdue - b.overdue || (a.oldest_overdue_days ?? 0) - (b.oldest_overdue_days ?? 0),
}

const PROJECT_COLUMNS: ColumnSpec<ProjectDashboardRow, ProjectColumnKey> = {
  keys: PROJECT_COLUMN_KEYS,
  first: { project: 'asc', client: 'asc', done: 'asc', waiting: 'desc', deadline: 'asc', overdue: 'desc' },
  hasValue: {
    project: () => true,
    client: row => row.client_name !== null,
    done: row => row.total > 0,
    waiting: () => true,
    deadline: row => row.next_deadline !== null,
    overdue: () => true,
  },
  compare: {
    project: byLabel,
    client: (a, b) => (a.client_name ?? '').localeCompare(b.client_name ?? '', 'ro'),
    // Raportul, nu numărul brut: „3/4" e mai avansat decât „5/40", iar coloana
    // răspunde la „cât din proiect e gata". Apelat doar când `total > 0`.
    done: (a, b) => a.done / a.total - b.done / b.total,
    ...TOTALS_COMPARE,
  },
}

const CONSULTANT_COLUMNS: ColumnSpec<ConsultantDashboardRow, ConsultantColumnKey> = {
  keys: CONSULTANT_COLUMN_KEYS,
  first: { consultant: 'asc', projects: 'desc', waiting: 'desc', deadline: 'asc', overdue: 'desc' },
  hasValue: {
    consultant: () => true,
    projects: () => true,
    waiting: () => true,
    deadline: row => row.next_deadline !== null,
    overdue: () => true,
  },
  compare: {
    consultant: byLabel,
    // Câte proiecte îl întind pe consultant; la egalitate, cine are mai multă muncă.
    projects: (a, b) => a.projects - b.projects || a.total - b.total,
    ...TOTALS_COMPARE,
  },
}

/**
 * Ordinea implicită: întâi cele cu termene depășite, cele mai multe primele, la
 * egalitate cele cu depășirea cea mai veche, apoi cât de aproape e următorul
 * termen.
 */
function byUrgency(a: Row, b: Row): number {
  if (a.overdue !== b.overdue) return b.overdue - a.overdue
  // Tot atâtea depășiri: le desparte vechimea celei mai vechi.
  const oldest = (b.oldest_overdue_days ?? 0) - (a.oldest_overdue_days ?? 0)
  if (oldest !== 0) return oldest
  if (a.next_deadline === null || b.next_deadline === null) {
    if (a.next_deadline !== b.next_deadline) return a.next_deadline === null ? 1 : -1
  } else {
    const diff = new Date(a.next_deadline).getTime() - new Date(b.next_deadline).getTime()
    if (diff !== 0) return diff
  }
  return byLabel(a, b)
}

function sortRows<T extends Row, K extends string>(
  spec: ColumnSpec<T, K>,
  rows: T[],
  sort: 'urgency' | K,
  direction: SortDirection,
): T[] {
  if (sort === 'urgency') return [...rows].sort(byUrgency)

  const withValue: T[] = []
  const without: T[] = []
  for (const row of rows) (spec.hasValue[sort](row) ? withValue : without).push(row)

  // Egalitățile cad pe capul de rând, mereu crescător, ca ordinea să nu sară
  // între randări și ca inversarea coloanei să nu amestece și rândurile egale.
  const sign = direction === 'desc' ? -1 : 1
  withValue.sort((a, b) => sign * spec.compare[sort](a, b) || byLabel(a, b))

  // Rândurile fără valoare stau la final în ambele sensuri: „fără client" și
  // „fără termen" sunt absența unei valori, nu una mică sau mare. Aceeași
  // alegere ca grupul „Fără termen" din `DeadlineList`, ca ecranele să nu se
  // contrazică.
  return [...withValue, ...without.sort(byLabel)]
}

export const sortProjectRows = (
  rows: ProjectDashboardRow[],
  sort: ProjectSortKey,
  direction: SortDirection,
): ProjectDashboardRow[] => sortRows(PROJECT_COLUMNS, rows, sort, direction)

/**
 * Consultanții se sortează între ei; munca fără responsabil stă mereu la urmă.
 *
 * Nu e un consultant leneș, e o grămadă rămasă pe dinafară — amestecată în
 * clasament, ar fi ieșit prima aproape la orice coloană (azi ține 197 din cele
 * 274 de elemente) și ar fi împins oamenii adevărați sub ea. Aceeași alegere ca
 * la „Fără termen": absența unei valori stă la final, în ambele sensuri.
 */
export const sortConsultantRows = (
  rows: ConsultantDashboardRow[],
  sort: ConsultantSortKey,
  direction: SortDirection,
): ConsultantDashboardRow[] => {
  const named = rows.filter(row => row.assigned)
  const unassigned = rows.filter(row => !row.assigned)
  return [...sortRows(CONSULTANT_COLUMNS, named, sort, direction), ...unassigned]
}

/** Ciclul unui antet: prima apăsare, inversul, apoi înapoi la ordinea implicită. */
function nextSort<K extends string>(
  spec: ColumnSpec<Row, K> | ColumnSpec<never, K>,
  current: { sort: 'urgency' | K; direction: SortDirection },
  column: K,
): { sort: 'urgency' | K; direction: SortDirection } {
  const first = spec.first[column]
  if (current.sort !== column) return { sort: column, direction: first }
  if (current.direction === first) {
    return { sort: column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { sort: 'urgency', direction: 'asc' }
}

export const nextProjectSort = (
  current: { sort: ProjectSortKey; direction: SortDirection },
  column: ProjectColumnKey,
) => nextSort(PROJECT_COLUMNS as unknown as ColumnSpec<Row, ProjectColumnKey>, current, column)

export const nextConsultantSort = (
  current: { sort: ConsultantSortKey; direction: SortDirection },
  column: ConsultantColumnKey,
) => nextSort(CONSULTANT_COLUMNS as unknown as ColumnSpec<Row, ConsultantColumnKey>, current, column)

/** Sensul primei apăsări, pentru antetele tabelului de proiecte. */
export const FIRST_SORT_DIRECTION = PROJECT_COLUMNS.first
export const FIRST_CONSULTANT_SORT_DIRECTION = CONSULTANT_COLUMNS.first

// ─── Starea tabelului în URL ──────────────────────────────────────────────────
//
// Ca la calendar: un tabel sortat trebuie să se poată trimite mai departe ca
// link. Se scrie doar ce se abate de la implicit, ca adresa obișnuită să rămână
// curată. Numele n-au nevoie de prefix — ecranul nu împarte URL-ul cu nimeni.

const TABLE_PARAM = { sort: 'sort', dir: 'dir', ended: 'incheiate', search: 'q', view: 'vedere' } as const

/**
 * Care din cele două tabele e deschis. Proiectele sunt implicite, deci nu lasă
 * nimic în adresă; consultanții se scriu, ca vederea să se poată trimite ca link.
 */
export type DashboardView = 'projects' | 'consultants'

export function readDashboardView(params: URLSearchParams): DashboardView {
  return params.get(TABLE_PARAM.view) === 'consultanti' ? 'consultants' : 'projects'
}

export function writeDashboardView(params: URLSearchParams, view: DashboardView): void {
  if (view === 'consultants') params.set(TABLE_PARAM.view, 'consultanti')
  else params.delete(TABLE_PARAM.view)
}

function readSort<K extends string>(
  params: URLSearchParams,
  keys: readonly K[],
  first: Record<K, SortDirection>,
): { sort: 'urgency' | K; direction: SortDirection } {
  const raw = params.get(TABLE_PARAM.sort)
  // O coloană necunoscută — inclusiv una a celuilalt tabel, rămasă în adresă la
  // comutare — cade pe ordinea implicită, nu pe o sortare inventată.
  if (!(keys as readonly string[]).includes(raw ?? '')) return { sort: 'urgency', direction: 'asc' }

  const sort = raw as K
  const dir = params.get(TABLE_PARAM.dir)
  return { sort, direction: dir === 'asc' || dir === 'desc' ? dir : first[sort] }
}

function writeSort<K extends string>(
  params: URLSearchParams,
  { sort, direction }: { sort: 'urgency' | K; direction: SortDirection },
  first: Record<K, SortDirection>,
): void {
  if (sort === 'urgency') {
    params.delete(TABLE_PARAM.sort)
    params.delete(TABLE_PARAM.dir)
    return
  }
  params.set(TABLE_PARAM.sort, sort)
  if (direction === first[sort]) params.delete(TABLE_PARAM.dir)
  else params.set(TABLE_PARAM.dir, direction)
}

export const readProjectSort = (params: URLSearchParams) =>
  readSort(params, PROJECT_COLUMN_KEYS, PROJECT_COLUMNS.first)

export const writeProjectSort = (
  params: URLSearchParams,
  value: { sort: ProjectSortKey; direction: SortDirection },
) => writeSort(params, value, PROJECT_COLUMNS.first)

export const readConsultantSort = (params: URLSearchParams) =>
  readSort(params, CONSULTANT_COLUMN_KEYS, CONSULTANT_COLUMNS.first)

export const writeConsultantSort = (
  params: URLSearchParams,
  value: { sort: ConsultantSortKey; direction: SortDirection },
) => writeSort(params, value, CONSULTANT_COLUMNS.first)

export function readShowEnded(params: URLSearchParams): boolean {
  return params.get(TABLE_PARAM.ended) === '1'
}

export function writeShowEnded(params: URLSearchParams, show: boolean): void {
  if (show) params.set(TABLE_PARAM.ended, '1')
  else params.delete(TABLE_PARAM.ended)
}

export function readSearch(params: URLSearchParams): string {
  return params.get(TABLE_PARAM.search) ?? ''
}

export function writeSearch(params: URLSearchParams, value: string): void {
  const trimmed = value.trim()
  if (trimmed) params.set(TABLE_PARAM.search, trimmed)
  else params.delete(TABLE_PARAM.search)
}

// ─── Căutarea în tabel ────────────────────────────────────────────────────────

/**
 * Sub pragul ăsta caseta de căutare nu apare: un tabel de câteva rânduri se
 * citește dintr-o privire, iar un control care nu ajută la nimic e tot un
 * control de citit. Aceeași regulă ca la comutatorul de proiecte încheiate, care
 * apare doar când chiar ascunde ceva.
 */
export const SEARCH_THRESHOLD = 8

/**
 * Fără diacritice și fără majuscule: „ACHIZIȚIE" trebuie găsit și scriind
 * „achizitie", de la o tastatură fără diacritice — cea de pe care se scrie, de
 * altfel, jumătate din titlurile din bază.
 */
const foldForSearch = (value: string): string =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Caută în titlu și în numele clientului: ambele sunt vizibile în tabel. */
export function filterProjectRows(rows: ProjectDashboardRow[], query: string): ProjectDashboardRow[] {
  const needle = foldForSearch(query.trim())
  if (!needle) return rows
  return rows.filter(row => foldForSearch(`${row.label} ${row.client_name ?? ''}`).includes(needle))
}

/** La consultanți, capul de rând e tot ce se caută: numele. */
export function filterConsultantRows(rows: ConsultantDashboardRow[], query: string): ConsultantDashboardRow[] {
  const needle = foldForSearch(query.trim())
  if (!needle) return rows
  return rows.filter(row => foldForSearch(row.label).includes(needle))
}

// ─── Puntea către calendar ────────────────────────────────────────────────────

/**
 * Linkul către calendarul general, deschis în modul listă pe un singur proiect.
 *
 * Construit din aceleași chei ca filtrele calendarului, nu din litere scrise de
 * mână aici: un `cj` copiat în altă parte s-ar strica în tăcere la prima
 * redenumire. Tabloul trimite în calendar în loc să-și crească propriile filtre
 * pe responsabil și pe fază — calendarul le are deja, iar două seturi ar fi
 * început să se contrazică.
 */
export function projectCalendarHref(
  projectId: string,
  options: { overdueOnly?: boolean } = {},
): string {
  const params = new URLSearchParams()
  writeViewMode(params, 'list')
  params.set(PARAM.projects, projectId)
  if (options.overdueOnly) params.set(PARAM.progress, 'overdue')
  return `/calendar?${params.toString()}`
}

/**
 * Aceeași punte, pentru un consultant: toate termenele lui, din toate proiectele.
 * `UNASSIGNED_OWNER_ID` trece ca atare — filtrul de responsabil al calendarului
 * are deja opțiunea „Fără responsabil", deci și rândul fără nimeni duce undeva.
 */
export function consultantCalendarHref(
  assigneeId: string,
  options: { overdueOnly?: boolean } = {},
): string {
  const params = new URLSearchParams()
  writeViewMode(params, 'list')
  params.set(PARAM.owners, assigneeId)
  if (options.overdueOnly) params.set(PARAM.progress, 'overdue')
  return `/calendar?${params.toString()}`
}
