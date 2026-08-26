'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BellOff,
  ChevronRight,
  ChevronsUpDown,
  LayoutDashboard,
  Loader2,
  Search,
  UserX,
} from 'lucide-react'

import {
  SEARCH_THRESHOLD,
  WAITING_LABELS,
  buildConsultantDashboardRows,
  buildProjectDashboardRows,
  countLabel,
  filterConsultantRows,
  filterProjectRows,
  formatRelativeDeadline,
  formatShortDate,
  nextConsultantSort,
  nextProjectSort,
  consultantCalendarHref,
  projectCalendarHref,
  readDashboardView,
  readConsultantSort,
  readProjectSort,
  readSearch,
  readShowEnded,
  sortConsultantRows,
  sortProjectRows,
  summarizeRows,
  writeDashboardView,
  writeConsultantSort,
  writeProjectSort,
  writeSearch,
  writeShowEnded,
  type CalendarEvent,
  type CalendarPayload,
  type DashboardSummary,
  type DashboardTotals,
  type DashboardView,
  type ConsultantColumnKey,
  type ConsultantDashboardRow,
  type ProjectColumnKey,
  type ProjectDashboardRow,
  type SortDirection,
} from '@/lib/calendar'
import EventRow from '@/components/calendar/EventRow'
import { useAuth } from '@/app/providers/AuthProvider'

interface Column<K extends string> {
  key: K
  label: string
  numeric?: boolean
  hint?: string
  /**
   * Coloana care absoarbe lățimea rămasă. Fără ea, un tabel de cinci coloane pe
   * un ecran lat își împrăștie cifrele până la marginile lui, iar rândul devine
   * imposibil de citit dintr-o privire. Restul coloanelor se strâng pe conținut.
   */
  grow?: boolean
  /** Clasa de ascundere sub un anumit prag. Vezi `HIDE`. */
  hide?: string
}

/**
 * De la ce lățime în sus apare fiecare coloană secundară.
 *
 * Pe un telefon în picioare încap trei coloane: capul de rând, termenul următor
 * și depășitele — adică „ce e" și „cât de rău e". Restul se adaugă pe măsură ce
 * e loc. Până acum tabelul avea lățime minimă fixă și se derula lateral, deci
 * coloana cu depășiri se vedea abia după ce trăgeai de el cu degetul.
 *
 * Aceleași clase se pun și pe antet, și pe celulă — de aceea stau aici, într-un
 * loc: două praguri diferite ar fi decalat coloanele între ele.
 */
const HIDE = {
  /** Clientul se citește oricum din titlul proiectului, în cele mai multe cazuri. */
  client: 'hidden lg:table-cell',
  done: 'hidden md:table-cell',
  projects: 'hidden md:table-cell',
  waiting: 'hidden sm:table-cell',
} as const

const DEADLINE_HINT =
  'Cel mai apropiat termen viitor; dedesubt, câte termene cad în 7 zile și câte elemente nefinalizate n-au niciunul'
const WAITING_HINT =
  'Munca rămasă, împărțită după cine o mișcă mai departe: echipa (activități neterminate, documente de verificat) sau clientul (documente cerute sau respinse)'
const OVERDUE_HINT = 'Termene trecute, pe elemente nefinalizate'

const PROJECT_COLUMNS: Column<ProjectColumnKey>[] = [
  { key: 'project', label: 'Proiect', grow: true },
  { key: 'client', label: 'Client', hide: HIDE.client },
  {
    key: 'done',
    label: 'Finalizate',
    numeric: true,
    hint: 'Activități încheiate și documente aprobate, din total',
    hide: HIDE.done,
  },
  { key: 'waiting', label: 'De rezolvat', numeric: true, hint: WAITING_HINT, hide: HIDE.waiting },
  { key: 'deadline', label: 'Următorul termen', hint: DEADLINE_HINT },
  { key: 'overdue', label: 'Depășite', numeric: true, hint: OVERDUE_HINT },
]

const CONSULTANT_COLUMNS: Column<ConsultantColumnKey>[] = [
  { key: 'consultant', label: 'Consultant', grow: true },
  {
    key: 'projects',
    label: 'Proiecte',
    numeric: true,
    hint: 'În câte proiecte are de lucru',
    hide: HIDE.projects,
  },
  { key: 'waiting', label: 'De rezolvat', numeric: true, hint: WAITING_HINT, hide: HIDE.waiting },
  { key: 'deadline', label: 'Următorul termen', hint: DEADLINE_HINT },
  { key: 'overdue', label: 'Depășite', numeric: true, hint: OVERDUE_HINT },
]

/** Câte termene încap în rândul desfășurat înainte să înceapă să înece tabelul. */
const DETAIL_LIMIT = 5

/**
 * Cât așteaptă căutarea înainte să ajungă în adresă. Destul cât o tastare
 * obișnuită să scrie o singură dată în istoric, prea puțin cât să se simtă.
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Tabloul de bord al administratorului (cerința 23), în două vederi peste
 * aceleași date: proiectele și consultanții.
 *
 * „Proiecte" răspunde la „cum stă fiecare lucrare", „Consultanți" la „cine e blocat
 * și cine e liber". Amândouă se calculează din aceeași singură cerere la
 * `/api/calendar` și prin același cod de agregare — dacă „depășit" ar fi
 * însemnat altceva de la un tabel la altul, ecranul s-ar fi contrazis la vedere.
 *
 * Ecran separat de Home în mod deliberat. Home răspunde la „ce necesită atenție
 * acum" și o face cu carduri; ăsta răspunde la „cum stă totul" și o face cu
 * tabele.
 *
 * Fiecare celulă are voie la cel mult două rânduri: cifra care se compară
 * deasupra, lămurirea ei dedesubt, mică și ștearsă. De aceea „săptămâna asta" și
 * „neplanificate" stau sub termenul următor, iar „la client" sub „la noi".
 *
 * Rândul se desface, ca ecranul să nu fie o fundătură: numărul „3 depășite"
 * spune că e o problemă, dar nu care e. Desfășurat, arată chiar elementele, cu
 * responsabil și link direct — fără altă cerere.
 *
 * Stadiul de proiect nu apare aici în nicio formă: e ascuns din toată interfața,
 * iar cele două coloane care l-ar putea alimenta — `current_status_id` și
 * `status` — nu sunt întreținute de nimic după importul șablonului.
 *
 * Nu modifică nimic; agregarea e în `lib/calendar.ts`.
 */
function ProjectDashboardContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { loading: authLoading, token, profile, apiFetch } = useAuth()

  const [payload, setPayload] = useState<CalendarPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    if (authLoading) return
    if (!token) { router.replace('/login'); return }
    if (profile && !isAdmin) router.replace('/')
  }, [authLoading, token, profile, isAdmin, router])

  // ─── Încărcare ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/calendar')
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // `apiFetch` înlocuiește `error` cu un mesaj generic; motivul real vine
        // pe `message` (convenția din #70).
        setError(data?.message || 'Nu am putut încărca proiectele.')
        return
      }
      setPayload(data as CalendarPayload)
    } catch {
      setError('Nu am putut încărca proiectele.')
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (authLoading || !token || !isAdmin) return
    load()
  }, [authLoading, token, isAdmin, load])

  // ─── Stare în URL ───────────────────────────────────────────────────────────
  //
  // Vederea, sortarea, căutarea și comutatorul trăiesc în URL, ca o vedere să se
  // poată trimite mai departe ca link. Optimismul de mai jos e cel din
  // `CalendarSurface`: ce scriem se vede pe loc, dar cade de îndată ce URL-ul
  // ajunge altundeva (Back, un link deschis în pagină), ca să nu rămână controale
  // care arată altceva decât spune adresa.
  //
  // Rândurile desfășurate nu intră în URL: sunt un gest de citire, nu o definiție
  // a vederii, și s-ar fi întors la fiecare deschidere de link cu jumătate de
  // tabel deja desfăcut.
  const query = searchParams.toString()
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null)

  useEffect(() => {
    if (pending && pending.from !== query) setPending(null)
  }, [pending, query])

  const params = useMemo(
    () => new URLSearchParams(pending && pending.from === query ? pending.to : query),
    [pending, query]
  )

  const syncUrl = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString())
      mutate(next)
      const to = next.toString()
      if (to === params.toString()) return
      setPending({ from: query, to })
      router.replace(to ? `${pathname}?${to}` : pathname, { scroll: false })
    },
    [params, query, pathname, router]
  )

  const view = useMemo(() => readDashboardView(params), [params])
  const projectSort = useMemo(() => readProjectSort(params), [params])
  const consultantSort = useMemo(() => readConsultantSort(params), [params])
  const showEnded = useMemo(() => readShowEnded(params), [params])
  const search = useMemo(() => readSearch(params), [params])

  // ─── Căutarea ───────────────────────────────────────────────────────────────
  //
  // Ce s-a tastat, ținut local; URL-ul primește valoarea puțin mai târziu.
  // Legat direct la URL, câmpul nu putea primi spațiu: `writeSearch` taie
  // capetele, deci adresa rămânea „femeia" cât utilizatorul scria „femeia a", iar
  // câmpul controlat îi ștergea spațiul înapoi la fiecare tastă.
  const [draft, setDraft] = useState(search)

  useEffect(() => { setDraft(search) }, [search])

  useEffect(() => {
    if (draft === search) return
    const timer = setTimeout(() => syncUrl(next => writeSearch(next, draft)), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, search, syncUrl])

  // ─── Derivate ───────────────────────────────────────────────────────────────

  const allProjects = useMemo(() => (payload ? buildProjectDashboardRows(payload) : []), [payload])
  const endedCount = useMemo(() => allProjects.filter(row => !row.active).length, [allProjects])
  const inScope = useMemo(
    () => (showEnded ? allProjects : allProjects.filter(row => row.active)),
    [allProjects, showEnded]
  )

  const projectRows = useMemo(
    () => sortProjectRows(filterProjectRows(inScope, draft), projectSort.sort, projectSort.direction),
    [inScope, draft, projectSort]
  )

  // Consultanții se strâng peste exact proiectele vizibile alături: cu comutatorul
  // oprit, cele două tabele n-au voie să descrie mulțimi diferite.
  const allConsultants = useMemo(
    () => (payload ? buildConsultantDashboardRows(payload, new Set(inScope.map(row => row.id))) : []),
    [payload, inScope]
  )
  const consultantRows = useMemo(
    () => sortConsultantRows(filterConsultantRows(allConsultants, draft), consultantSort.sort, consultantSort.direction),
    [allConsultants, draft, consultantSort]
  )

  // Munca fără responsabil e grămada rămasă pe dinafară, nu un consultant: stă
  // în capul tabelului, dar n-are ce căuta nici în numărătoarea de consultanți,
  // nici în „la câți dintre ei sunt depășiri". Își primește propria mențiune.
  const namedConsultants = useMemo(() => consultantRows.filter(row => row.assigned), [consultantRows])
  const unassigned = useMemo(() => consultantRows.find(row => !row.assigned) ?? null, [consultantRows])

  const visibleCount = view === 'projects' ? projectRows.length : consultantRows.length
  const scopeCount = view === 'projects' ? inScope.length : allConsultants.length
  const summary = useMemo(
    () => summarizeRows(view === 'projects' ? projectRows : namedConsultants),
    [view, projectRows, namedConsultants]
  )

  // Caseta de căutare apare doar peste prag — sau când tot ea e cea care a redus
  // tabelul, altfel ar dispărea odată cu rândurile pe care le-a filtrat.
  const showSearch = scopeCount > SEARCH_THRESHOLD || draft.length > 0

  // Un singur rând deschis odată. Cu mai multe desfăcute, panourile se pun cap
  // la cap și tabelul dispare între ele — exact ce nu trebuie să facă un ecran
  // din care se citește o listă.
  const [open, setOpen] = useState<string | null>(null)
  const toggle = useCallback((id: string) => {
    setOpen(current => (current === id ? null : id))
  }, [])

  const switchView = useCallback(
    (next: DashboardView) => {
      if (next === view) return
      // Căutarea se golește la comutare: „achizitie" scris peste proiecte n-ar
      // găsi niciun consultant, iar celălalt tabel s-ar deschide gol fără motiv vizibil.
      setDraft('')
      setOpen(null)
      syncUrl(params => { writeDashboardView(params, next); writeSearch(params, '') })
    },
    [view, syncUrl]
  )

  // ─── Randare ────────────────────────────────────────────────────────────────

  // `!profile` face parte din gardă: cât profilul se încarcă, rolul e necunoscut,
  // iar fără el un consultant ar apuca să monteze tabelul înainte de redirect.
  if (authLoading || !token || !profile || !isAdmin) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Se încarcă...
      </div>
    )
  }

  const ready = !loading && !error

  return (
    // `project-scope` aduce paleta `--p-*`, ca ecranul să arate ca restul
    // suprafețelor de lucru.
    <div className="project-scope space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Aceeași pastilă de antet ca în calendar și în restul ecranelor:
              minimalismul de aici nu e un motiv ca pagina să arate străină. */}
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--p-accent-soft)]">
            <LayoutDashboard className="h-5 w-5 text-[var(--p-accent)]" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-lg font-semibold text-[var(--p-ink)]">Tablou de bord</h1>
            {/* Rezumatul ține loc de subtitlu: aceleași cifre, în locul unei
                propoziții care ar fi repetat numele coloanelor. */}
            {ready && <SummaryLine summary={summary} view={view} unassigned={unassigned} />}
          </div>
        </div>

        {ready && (
          <div className="flex flex-wrap items-center gap-4">
            <ViewSwitch view={view} onSwitch={switchView} />

            {showSearch && (
              <label className="relative">
                <span className="sr-only">
                  {view === 'projects' ? 'Caută după proiect sau client' : 'Caută după numele consultantului'}
                </span>
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--p-ink-faint)]"
                  aria-hidden
                />
                <input
                  type="search"
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  placeholder={view === 'projects' ? 'Caută proiect' : 'Caută consultant'}
                  className="h-8 w-44 rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)] pl-8 pr-2.5 text-sm text-[var(--p-ink)] placeholder:text-[var(--p-ink-faint)] focus:border-[var(--p-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--p-accent-soft)]"
                />
              </label>
            )}

            {/* Comutatorul apare numai când chiar ascunde ceva: altfel ar fi un
                control care nu face nimic vizibil pe toată platforma. */}
            {(endedCount > 0 || showEnded) && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--p-ink-soft)]">
                <input
                  type="checkbox"
                  checked={showEnded}
                  onChange={event => {
                    const checked = event.target.checked
                    syncUrl(next => writeShowEnded(next, checked))
                  }}
                  className="h-3.5 w-3.5 rounded border-[var(--p-border-strong)] text-[var(--p-accent)] focus:ring-[var(--p-accent)]"
                />
                Și proiectele încheiate
                {!showEnded && endedCount > 0 && (
                  <span className="text-[var(--p-ink-faint)]">({endedCount})</span>
                )}
              </label>
            )}
          </div>
        )}
      </header>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--p-danger)] bg-[var(--p-danger-soft)] px-4 py-3 text-sm text-[var(--p-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <div className="space-y-2">
            <p>{error}</p>
            <button type="button" onClick={load} className="font-semibold underline underline-offset-2">
              Reîncearcă
            </button>
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-[var(--p-ink-soft)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Se încarcă proiectele...
        </div>
      ) : visibleCount === 0 ? (
        <EmptyView
          view={view}
          search={draft}
          hasProjects={allProjects.length > 0}
          onClearSearch={() => setDraft('')}
        />
      ) : view === 'projects' ? (
        <TableFrame>
          <SortHeader
            columns={PROJECT_COLUMNS}
            sort={projectSort}
            onSort={column => syncUrl(next => writeProjectSort(next, nextProjectSort(projectSort, column)))}
          />
          <tbody>
            {projectRows.map(row => (
              <ProjectRow key={row.id} row={row} open={open === row.id} onToggle={() => toggle(row.id)} />
            ))}
          </tbody>
        </TableFrame>
      ) : (
        <TableFrame>
          <SortHeader
            columns={CONSULTANT_COLUMNS}
            sort={consultantSort}
            onSort={column => syncUrl(next => writeConsultantSort(next, nextConsultantSort(consultantSort, column)))}
          />
          <tbody>
            {consultantRows.map(row => (
              <ConsultantRow key={row.id} row={row} open={open === row.id} onToggle={() => toggle(row.id)} />
            ))}
          </tbody>
        </TableFrame>
      )}
    </div>
  )
}

// ─── Controale ────────────────────────────────────────────────────────────────

function ViewSwitch({ view, onSwitch }: { view: DashboardView; onSwitch: (view: DashboardView) => void }) {
  const options: { key: DashboardView; label: string }[] = [
    { key: 'projects', label: 'Proiecte' },
    { key: 'consultants', label: 'Consultanți' },
  ]

  return (
    <div className="inline-flex rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)] p-0.5">
      {options.map(option => (
        <button
          key={option.key}
          type="button"
          onClick={() => onSwitch(option.key)}
          aria-pressed={view === option.key}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)] ${
            view === option.key
              ? 'bg-[var(--p-accent-soft)] text-[var(--p-accent)]'
              : 'text-[var(--p-ink-soft)] hover:text-[var(--p-ink)]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Cifrele de deasupra tabelului, într-o singură propoziție scurtă. Nu carduri
 * mari: Home are deja indicatorii lui, iar două seturi ar începe să se
 * contrazică. Culoare doar pe depășiri — restul e text.
 */
function SummaryLine({
  summary,
  view,
  unassigned,
}: {
  summary: DashboardSummary
  view: DashboardView
  /** Grămada fără responsabil, dacă vederea de consultanți o arată. */
  unassigned: DashboardTotals | null
}) {
  const projects = view === 'projects'
  const subject = projects
    ? countLabel(summary.rows, 'proiect', 'proiecte')
    : countLabel(summary.rows, 'consultant', 'consultanți')

  const pieces: { text: string; tone?: 'danger' | 'warning' }[] = [
    { text: subject },
    summary.overdue > 0
      ? {
          // „în 3 proiecte", dar „la 3 consultanți": depășirile stau într-o
          // lucrare și sunt la un om.
          text: `${countLabel(summary.overdue, 'depășit', 'depășite')} ${projects ? 'în' : 'la'} ${
            projects
              ? countLabel(summary.rowsWithOverdue, 'proiect', 'proiecte')
              : countLabel(summary.rowsWithOverdue, 'consultant', 'consultanți')
          }`,
          tone: 'danger' as const,
        }
      : { text: 'niciun termen depășit' },
  ]
  if (summary.dueSoon > 0) pieces.push({ text: `${summary.dueSoon} săptămâna asta` })
  if (summary.waitingUs > 0) pieces.push({ text: `${summary.waitingUs} ${WAITING_LABELS.us}` })

  // Cea mai mare grămadă din platformă merită spusă, nu ascunsă în ultimul rând
  // al tabelului — dar spusă separat, ca să nu umfle cifrele consultanților.
  if (!projects && unassigned && unassigned.total - unassigned.done > 0) {
    pieces.push({
      text: `${unassigned.total - unassigned.done} fără responsabil`,
      tone: 'warning',
    })
  }

  return (
    <p className="text-xs text-[var(--p-ink-soft)]">
      {pieces.map((piece, index) => (
        <Fragment key={piece.text}>
          {index > 0 && <span className="mx-2 text-[var(--p-ink-faint)]">·</span>}
          <span
            className={
              piece.tone === 'danger'
                ? 'text-[var(--p-danger)]'
                : piece.tone === 'warning'
                ? 'text-[var(--p-warning)]'
                : undefined
            }
          >
            {piece.text}
          </span>
        </Fragment>
      ))}
    </p>
  )
}

/**
 * Rama tabelului: același card ca listele calendarului și ca panourile paginii
 * de proiect. Fără ea, tabelul plutea direct pe fundalul paginii și arăta ca
 * dintr-o altă aplicație decât restul ecranelor.
 */
function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)]">
      {/* Fără lățime minimă fixă: coloanele se ascund pe rând (vezi `HIDE`), deci
          tabelul intră în ecran în loc să ceară derulare laterală. `overflow-x`
          rămâne plasa de siguranță pentru un titlu neobișnuit de lung. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    </div>
  )
}

function SortHeader<K extends string>({
  columns,
  sort,
  onSort,
}: {
  columns: Column<K>[]
  sort: { sort: 'urgency' | K; direction: SortDirection }
  onSort: (column: K) => void
}) {
  return (
    <thead>
      <tr className="border-b border-[var(--p-border)] bg-[var(--p-surface-2)]">
        {columns.map(column => {
          const active = sort.sort === column.key
          const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown
          return (
            <th
              key={column.key}
              scope="col"
              aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              className={`px-4 py-2.5 font-normal ${column.numeric ? 'text-right' : 'text-left'} ${
                column.grow ? 'w-full' : 'whitespace-nowrap'
              } ${column.hide ?? ''}`}
            >
              <button
                type="button"
                title={column.hint}
                onClick={() => onSort(column.key)}
                className={`group inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)] ${
                  active
                    ? 'font-semibold text-[var(--p-ink)]'
                    : 'text-[var(--p-ink-faint)] hover:text-[var(--p-ink-soft)]'
                }`}
              >
                {column.label}
                {/* Săgeata de sortare apare la nevoie: șase iconițe permanente
                    ar fi fost cel mai zgomotos lucru din tabel. */}
                <Icon
                  className={`h-3 w-3 transition-opacity ${
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60'
                  }`}
                  aria-hidden
                />
              </button>
            </th>
          )
        })}
      </tr>
    </thead>
  )
}

// ─── Celule împărțite între cele două tabele ──────────────────────────────────

const FAINT = 'text-[var(--p-ink-faint)]'
/** Al doilea rând al unei celule: lămurirea cifrei de deasupra. */
const NOTE = `block text-[11px] leading-tight ${FAINT}`

/** Acțiunile din subsolul panoului, în forma pastilelor din restul aplicației. */
const PANEL_ACTION =
  'inline-flex items-center rounded-lg border border-[var(--p-border)] bg-[var(--p-surface)] px-2.5 py-1 font-medium text-[var(--p-accent)] transition-colors hover:bg-[var(--p-accent-soft)]'

/** „de o zi", „de 12 zile", „de 21 de zile" — vechimea de sub numărul roșu. */
function overdueAge(days: number): string {
  return days === 1 ? 'de o zi' : `de ${countLabel(days, 'zi', 'zile')}`
}

function WaitingCell({ row }: { row: DashboardTotals }) {
  if (row.waiting_us + row.waiting_client === 0) {
    return (
      <td className={`px-4 py-3.5 text-right whitespace-nowrap ${HIDE.waiting}`}>
        <span className={FAINT}>—</span>
      </td>
    )
  }
  return (
    <td className={`px-4 py-3.5 text-right whitespace-nowrap ${HIDE.waiting}`}>
      <span className="tabular-nums">
        <span className={row.waiting_us > 0 ? 'font-semibold text-[var(--p-ink)]' : FAINT}>
          {row.waiting_us}
        </span>
        <span className={`ml-1 text-[11px] ${FAINT}`}>{WAITING_LABELS.us}</span>
      </span>
      {row.waiting_client > 0 && (
        <span className={`${NOTE} tabular-nums`}>
          {row.waiting_client} {WAITING_LABELS.client}
        </span>
      )}
    </td>
  )
}

function DeadlineCell({ row }: { row: DashboardTotals }) {
  const relative = formatRelativeDeadline(row.next_deadline)

  // „Mâine" e deja pe rândul de deasupra; al doilea termen din aceeași
  // săptămână e cel care schimbă imaginea, deci numărul apare de la două în sus.
  const weekNote = row.due_soon > 1 ? `${row.due_soon} săptămâna asta` : null

  // Cât din munca rămasă nu e prinsă de nicio dată. Fără el, celula de deasupra
  // spune „20 aug." și lasă impresia unui rând planificat, când termenul acela
  // poate fi singurul din cincizeci de elemente.
  const undatedNote = row.undated > 0 ? countLabel(row.undated, 'neplanificat', 'neplanificate') : null

  return (
    // Data nu se rupe niciodată; lămurirea de sub ea are voie să treacă pe două
    // rânduri, altfel „în 2 zile · 4 săptămâna asta · 11 neplanificate" ar fi
    // ținut singură coloana lată cât un telefon întreg.
    <td className="px-4 py-3.5">
      {row.next_deadline === null ? (
        <>
          <span className={`whitespace-nowrap ${FAINT}`}>Fără termen</span>
          {undatedNote && <span className={NOTE}>{undatedNote}</span>}
        </>
      ) : (
        <>
          <span className="whitespace-nowrap text-[var(--p-ink)]">{formatShortDate(row.next_deadline)}</span>
          {[relative, weekNote, undatedNote].filter(Boolean).length > 0 && (
            <span className={NOTE}>{[relative, weekNote, undatedNote].filter(Boolean).join(' · ')}</span>
          )}
        </>
      )}
    </td>
  )
}

function OverdueCell({ row }: { row: DashboardTotals }) {
  return (
    <td className="px-4 py-3.5 text-right whitespace-nowrap">
      {row.overdue === 0 ? (
        <span className={FAINT}>—</span>
      ) : (
        <>
          <span className="font-semibold tabular-nums text-[var(--p-danger)]">{row.overdue}</span>
          {row.oldest_overdue_days !== null && (
            <span className={NOTE}>{overdueAge(row.oldest_overdue_days)}</span>
          )}
        </>
      )}
    </td>
  )
}

function ExpandButton({
  open,
  onToggle,
  detailsId,
  label,
}: {
  open: boolean
  onToggle: () => void
  detailsId: string
  label: string
}) {
  return (
    <button
      type="button"
      onClick={event => { event.stopPropagation(); onToggle() }}
      aria-expanded={open}
      // Doar cât rândul chiar există: `aria-controls` către un id absent e o
      // referință ruptă pentru cititoarele de ecran.
      aria-controls={open ? detailsId : undefined}
      aria-label={`${open ? 'Ascunde' : 'Arată'} termenele — ${label}`}
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:text-[var(--p-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)] ${FAINT}`}
    >
      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
    </button>
  )
}

// ─── Rândul de proiect ────────────────────────────────────────────────────────

function ProjectRow({
  row,
  open,
  onToggle,
}: {
  row: ProjectDashboardRow
  open: boolean
  onToggle: () => void
}) {
  const detailsId = `detalii-${row.id}`

  return (
    <Fragment>
      {/* Rândul desface detaliile; titlul rămâne singurul drum către proiect.
          Un rând care ar face amândouă ar fi însemnat două înțelesuri pentru
          același clic, în funcție de unde nimerește. */}
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-[var(--p-border)] transition-colors last:border-b-0 hover:bg-[var(--p-surface-2)] ${
          open ? 'bg-[var(--p-surface-2)]' : ''
        }`}
      >
        <td className="py-3.5 pl-4 pr-3">
          <div className="flex items-center gap-1.5">
            <ExpandButton open={open} onToggle={onToggle} detailsId={detailsId} label={row.label} />

            <Link
              href={`/projects/${row.id}`}
              // Titlul e un link adevărat, ca ecranul să rămână accesibil de la
              // tastatură și proiectul să se poată deschide în tab nou.
              onClick={event => event.stopPropagation()}
              className="font-medium text-[var(--p-ink)] underline-offset-4 hover:underline"
            >
              {row.label}
            </Link>

            {!row.active && (
              <span className={`ml-1 rounded-full border border-[var(--p-border-strong)] px-1.5 text-[10px] uppercase tracking-wide ${FAINT}`}>
                Încheiat
              </span>
            )}

            {/* Doar starea oprită se arată, și doar ca semn: un proiect care nu
                mai trimite nimic automat își ține termenele din memoria cuiva.
                Comutarea rămâne unde se face administrarea — în Home și în
                pagina proiectului; tabloul nu modifică nimic. */}
            {row.reminders_off && (
              <span
                title="Reminderele automate sunt oprite pentru acest proiect."
                className="flex-shrink-0 text-[var(--p-warning)]"
              >
                <BellOff className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">Reminderele automate sunt oprite</span>
              </span>
            )}
          </div>
        </td>

        <td className={`px-4 py-3.5 text-[var(--p-ink-soft)] ${HIDE.client}`}>
          {row.client_name ?? <span className={FAINT}>—</span>}
        </td>

        <td
          className={`px-4 py-3.5 text-right tabular-nums whitespace-nowrap ${HIDE.done}`}
          title={`Activități ${row.activities.done}/${row.activities.total} · Documente ${row.requests.done}/${row.requests.total}`}
        >
          {row.total === 0 ? (
            <span className={FAINT}>Fără elemente</span>
          ) : (
            <span className={row.done === row.total ? 'font-semibold text-[var(--p-success)]' : 'text-[var(--p-ink)]'}>
              {row.done}/{row.total}
            </span>
          )}
        </td>

        <WaitingCell row={row} />
        <DeadlineCell row={row} />
        <OverdueCell row={row} />
      </tr>

      {open && (
        <tr id={detailsId} className="border-b border-[var(--p-border)] bg-[var(--p-surface-2)] last:border-b-0">
          <td colSpan={PROJECT_COLUMNS.length} className="py-4 pl-4 pr-4 sm:pl-11">
            <DetailPanel
              row={row}
              overdueHref={projectCalendarHref(row.id, { overdueOnly: true })}
              upcomingHref={projectCalendarHref(row.id)}
              links={
                <>
                  <Link href={`/projects/${row.id}`} className={PANEL_ACTION}>
                    Deschide proiectul
                  </Link>
                  <Link href={projectCalendarHref(row.id)} className={PANEL_ACTION}>
                    Vezi în calendar
                  </Link>
                </>
              }
            />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

// ─── Rândul de consultant ─────────────────────────────────────────────────────────────

function ConsultantRow({
  row,
  open,
  onToggle,
}: {
  row: ConsultantDashboardRow
  open: boolean
  onToggle: () => void
}) {
  const detailsId = `detalii-${row.id}`

  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-[var(--p-border)] transition-colors last:border-b-0 hover:bg-[var(--p-surface-2)] ${
          open ? 'bg-[var(--p-surface-2)]' : ''
        } ${
          // Linia care desparte grămada rămasă pe dinafară de consultanții de sub
          // ea: stă prima fiindcă e prima problemă, dar nu e un om.
          row.assigned ? '' : 'border-b-2 border-b-[var(--p-border-strong)]'
        }`}
      >
        <td className="py-3.5 pl-4 pr-3">
          <div className="flex items-center gap-1.5">
            <ExpandButton open={open} onToggle={onToggle} detailsId={detailsId} label={row.label} />

            {/* Munca fără nimeni în spate nu se ascunde și nu se scoate la
                sfârșit: e un rând ca oricare, fiindcă azi e cel mai încărcat
                dintre toate. */}
            {row.assigned ? (
              <span className="font-medium text-[var(--p-ink)]">{row.label}</span>
            ) : (
              <span className={`flex items-center gap-1.5 ${FAINT}`}>
                <UserX className="h-3.5 w-3.5" aria-hidden />
                {row.label}
              </span>
            )}
          </div>
        </td>

        <td className={`px-4 py-3.5 text-right tabular-nums whitespace-nowrap text-[var(--p-ink-soft)] ${HIDE.projects}`}>
          {row.projects}
          <span className={NOTE}>{countLabel(row.total, 'element', 'elemente')}</span>
        </td>

        <WaitingCell row={row} />
        <DeadlineCell row={row} />
        <OverdueCell row={row} />
      </tr>

      {open && (
        <tr id={detailsId} className="border-b border-[var(--p-border)] bg-[var(--p-surface-2)] last:border-b-0">
          <td colSpan={CONSULTANT_COLUMNS.length} className="py-4 pl-4 pr-4 sm:pl-11">
            <DetailPanel
              row={row}
              withProject
              overdueHref={consultantCalendarHref(row.id, { overdueOnly: true })}
              upcomingHref={consultantCalendarHref(row.id)}
              links={
                <Link href={consultantCalendarHref(row.id)} className={PANEL_ACTION}>
                  Vezi în calendar
                </Link>
              }
            />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

// ─── Rândul desfășurat ────────────────────────────────────────────────────────

/**
 * Chiar elementele din spatele numerelor, cu responsabil și link direct. Nicio
 * cerere nouă — termenele sunt deja în memorie, aduse ca să poată fi numărate.
 *
 * Insignele sunt neutre în ambele panouri. Culoarea răspunde, în calendar, la
 * „al cui e" — dar aici numele responsabilului e oricum scris pe fiecare rând,
 * deci culoarea nu adăuga nimic, iar două panouri pe același ecran, unul colorat
 * și unul nu, arătau ca două ecrane diferite.
 */
function DetailPanel({
  row,
  withProject = false,
  overdueHref,
  upcomingHref,
  links,
}: {
  row: DashboardTotals
  /** Termenele unui consultant vin din mai multe proiecte, deci proiectul trebuie scris. */
  withProject?: boolean
  overdueHref: string
  upcomingHref: string
  links: React.ReactNode
}) {
  const hasOverdue = row.overdue_events.length > 0
  const hasUpcoming = row.upcoming_events.length > 0

  return (
    <div className="space-y-3">
      {/* Listele goale nu se desenează. Până acum, un proiect fără niciun termen
          își cerea două coloane ca să scrie de două ori că n-are nimic, iar unul
          cu o singură listă lăsa jumătate de panou alb. */}
      {hasOverdue || hasUpcoming ? (
        <div className={`grid gap-x-8 gap-y-4 ${hasOverdue && hasUpcoming ? 'lg:grid-cols-2' : ''}`}>
          {hasOverdue && (
            <DetailList
              title="Depășite"
              events={row.overdue_events}
              tone="danger"
              moreHref={overdueHref}
              withProject={withProject}
              plainIcon
            />
          )}
          {hasUpcoming && (
            <DetailList
              title="Urmează"
              events={row.upcoming_events}
              moreHref={upcomingHref}
              withProject={withProject}
              plainIcon
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--p-ink-faint)]">
          Niciun termen: nici depășit, nici viitor.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-[var(--p-border)] pt-3 text-xs text-[var(--p-ink-soft)]">
        <p>
          {/* Aceleași numere, desfăcute pe sursă: raportul din rând e dominat de
              documente, deci singur nu spune dacă munca internă a avansat. */}
          Activități{' '}
          <span className="font-semibold tabular-nums text-[var(--p-ink)]">
            {row.activities.done}/{row.activities.total}
          </span>
          <span className="mx-2 text-[var(--p-ink-faint)]">·</span>
          Documente{' '}
          <span className="font-semibold tabular-nums text-[var(--p-ink)]">
            {row.requests.done}/{row.requests.total}
          </span>
          {row.drafts > 0 && (
            <>
              <span className="mx-2 text-[var(--p-ink-faint)]">·</span>
              <span className="text-[var(--p-draft)]">
                {countLabel(row.drafts, 'element', 'elemente')} în pregătire
              </span>
            </>
          )}
        </p>

        <span className="flex flex-wrap items-center gap-2">{links}</span>
      </div>
    </div>
  )
}

/** Randată doar când are ce arăta — vezi `DetailPanel`. */
function DetailList({
  title,
  events,
  moreHref,
  tone,
  withProject,
  plainIcon,
}: {
  title: string
  events: CalendarEvent[]
  moreHref: string
  tone?: 'danger'
  withProject?: boolean
  plainIcon?: boolean
}) {
  const shown = events.slice(0, DETAIL_LIMIT)
  const rest = events.length - shown.length

  return (
    // Antetul intră în card, pe aceeași bandă ca antetul tabelului de deasupra.
    // Plutind pe fundal, arăta ca o etichetă lipită lângă o cutie străină.
    <section
      aria-label={title}
      className="overflow-hidden rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)]"
    >
      <h3 className="flex items-baseline gap-2 border-b border-[var(--p-border)] bg-[var(--p-surface-2)] px-3 py-2 text-[11px] uppercase tracking-[0.08em]">
        <span className={tone === 'danger' ? 'text-[var(--p-danger)]' : 'text-[var(--p-ink-soft)]'}>{title}</span>
        <span className="text-[var(--p-ink-faint)] normal-case">{events.length}</span>
      </h3>

      {/* Același rând ca în lista de termene a calendarului, nu o copie a lui:
          aceleași culori, aceleași etichete, același link. Fără pastila de stare
          — antetul listei o spune deja o dată. */}
      <ul className="divide-y divide-[var(--p-border)]">
        {shown.map(event => (
          <EventRow
            key={`${event.kind}-${event.id}`}
            event={event}
            withProject={withProject}
            withProgress={false}
            plainIcon={plainIcon}
          />
        ))}
      </ul>

      {rest > 0 && (
        <Link
          href={moreHref}
          className="flex items-center justify-center gap-1 border-t border-[var(--p-border)] bg-[var(--p-surface-2)] px-3 py-2 text-xs font-medium text-[var(--p-accent)] hover:bg-[var(--p-accent-soft)]"
        >
          și încă {countLabel(rest, 'termen', 'termene')}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </section>
  )
}

// ─── Stări goale ──────────────────────────────────────────────────────────────

function EmptyView({
  view,
  search,
  hasProjects,
  onClearSearch,
}: {
  view: DashboardView
  search: string
  hasProjects: boolean
  onClearSearch: () => void
}) {
  if (search) {
    return (
      <EmptyState
        title={view === 'projects' ? 'Niciun proiect găsit' : 'Niciun consultant găsit'}
        description={
          view === 'projects'
            ? `Nimic nu se potrivește cu „${search}”, nici în titlu, nici la client.`
            : `Niciun nume de consultant nu se potrivește cu „${search}”.`
        }
        action={
          <button
            type="button"
            onClick={onClearSearch}
            className="text-sm font-medium text-[var(--p-accent)] underline underline-offset-2"
          >
            Șterge căutarea
          </button>
        }
      />
    )
  }

  if (view === 'consultants') {
    return (
      <EmptyState
        title="Nimeni n-are muncă atribuită"
        description="Aici apare fiecare consultant cu termenele lui, de îndată ce există elemente în proiectele vizibile."
      />
    )
  }

  return (
    <EmptyState
      title={hasProjects ? 'Niciun proiect în lucru' : 'Niciun proiect'}
      description={
        hasProjects
          ? 'Toate proiectele sunt încheiate. Pornește comutatorul de mai sus ca să le vezi.'
          : 'Aici apar toate proiectele din platformă, de îndată ce se creează primul.'
      }
    />
  )
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)] px-6 py-16 text-center">
      <LayoutDashboard className="h-7 w-7 text-[var(--p-ink-faint)]" aria-hidden />
      <h3 className="font-display text-base font-medium text-[var(--p-ink)]">{title}</h3>
      <p className="max-w-sm text-sm text-[var(--p-ink-soft)]">{description}</p>
      {action}
    </div>
  )
}

export default function ProjectDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
        </div>
      }
    >
      <ProjectDashboardContent />
    </Suspense>
  )
}
