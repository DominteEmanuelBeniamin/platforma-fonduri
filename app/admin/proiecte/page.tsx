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
} from 'lucide-react'

import {
  SEARCH_THRESHOLD,
  WAITING_LABELS,
  buildProjectDashboardRows,
  countLabel,
  filterProjectRows,
  formatRelativeDeadline,
  formatShortDate,
  nextProjectSort,
  projectCalendarHref,
  readProjectSort,
  readSearch,
  readShowEnded,
  sortProjectRows,
  summarizeProjectRows,
  writeProjectSort,
  writeSearch,
  writeShowEnded,
  type CalendarEvent,
  type CalendarPayload,
  type DashboardSummary,
  type ProjectColumnKey,
  type ProjectDashboardRow,
} from '@/lib/calendar'
import EventRow from '@/components/calendar/EventRow'
import { useAuth } from '@/app/providers/AuthProvider'

const COLUMNS: { key: ProjectColumnKey; label: string; numeric?: boolean; hint?: string }[] = [
  { key: 'project', label: 'Proiect' },
  { key: 'client', label: 'Client' },
  { key: 'done', label: 'Finalizate', numeric: true, hint: 'Activități încheiate și documente aprobate, din total' },
  {
    key: 'waiting',
    label: 'De rezolvat',
    numeric: true,
    hint: 'Munca rămasă, împărțită după cine o mișcă mai departe: echipa (activități neterminate, documente de verificat) sau clientul (documente cerute sau respinse)',
  },
  {
    key: 'deadline',
    label: 'Următorul termen',
    hint: 'Cel mai apropiat termen viitor; dedesubt, câte termene cad în 7 zile și câte elemente nefinalizate n-au niciunul',
  },
  { key: 'overdue', label: 'Depășite', numeric: true, hint: 'Termene trecute, pe elemente nefinalizate' },
]

/** Câte termene încap în rândul desfășurat înainte să înceapă să înece tabelul. */
const DETAIL_LIMIT = 5

/**
 * Cât așteaptă căutarea înainte să ajungă în adresă. Destul cât o tastare
 * obișnuită să scrie o singură dată în istoric, prea puțin cât să se simtă.
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Tabloul de bord al administratorului (cerința 23): toate proiectele, cât din
 * fiecare e finalizat, cine e dator cu munca rămasă, ce urmează și ce e depășit.
 *
 * Ecran separat de Home în mod deliberat. Home răspunde la „ce necesită atenție
 * acum" și o face cu carduri; ăsta răspunde la „cum stă fiecare proiect" și o
 * face cu un tabel. Forma diferă ca deosebirea să fie vizibilă, nu doar
 * conceptuală.
 *
 * Șase coloane, și fiecare celulă are voie la cel mult două rânduri: cifra care
 * se compară deasupra, contextul ei dedesubt, mic și șters. De aceea „săptămâna
 * asta" stă sub termenul următor, nu într-o coloană proprie, iar „la client"
 * stă sub „la noi" — sunt lămuriri, nu coloane de sortat.
 *
 * Rândul se desface, ca ecranul să nu fie o fundătură: numărul „3 depășite"
 * spune că e o problemă, dar nu care e. Desfășurat, arată chiar elementele, cu
 * responsabil și link direct — fără altă cerere, fiindcă termenele sunt deja
 * descărcate ca să poată fi numărate.
 *
 * Stadiul de proiect nu apare aici în nicio formă: e ascuns din toată interfața,
 * iar cele două coloane care l-ar putea alimenta — `current_status_id` și
 * `status` — nu sunt întreținute de nimic după importul șablonului.
 *
 * Nu modifică nimic. O singură cerere, la `/api/calendar`; agregarea e în
 * `lib/calendar.ts`, ca numerele de aici și cele din calendar să nu poată devia.
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
  // Sortarea, căutarea și comutatorul trăiesc în URL, ca o vedere să se poată
  // trimite mai departe ca link. Optimismul de mai jos e cel din
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

  const sort = useMemo(() => readProjectSort(params), [params])
  const showEnded = useMemo(() => readShowEnded(params), [params])
  const search = useMemo(() => readSearch(params), [params])

  // ─── Derivate ───────────────────────────────────────────────────────────────

  const allRows = useMemo(() => (payload ? buildProjectDashboardRows(payload) : []), [payload])
  const endedCount = useMemo(() => allRows.filter(row => !row.active).length, [allRows])
  const inScope = useMemo(
    () => (showEnded ? allRows : allRows.filter(row => row.active)),
    [allRows, showEnded]
  )
  // Ce s-a tastat, ținut local; URL-ul primește valoarea puțin mai târziu.
  //
  // Legat direct la URL, câmpul nu putea primi spațiu: `writeSearch` taie
  // capetele, deci adresa rămânea „femeia" cât utilizatorul scria „femeia a",
  // iar câmpul controlat îi ștergea spațiul înapoi la fiecare tastă. Căutarea
  // din două cuvinte era imposibil de scris. Tot de aici veneau și revenirile
  // de o clipă la un caracter mai vechi, când tastarea o lua înaintea rutei.
  const [draft, setDraft] = useState(search)

  // Adresa rămâne sursa de adevăr: Back, un link deschis în pagină sau golirea
  // căutării din altă parte se văd în câmp.
  useEffect(() => { setDraft(search) }, [search])

  useEffect(() => {
    if (draft === search) return
    const timer = setTimeout(() => syncUrl(next => writeSearch(next, draft)), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, search, syncUrl])

  // Tabelul urmează tastarea, nu URL-ul: filtrarea e locală și gratuită, iar o
  // pauză de un sfert de secundă între tastă și rânduri s-ar fi simțit ca lag.
  const rows = useMemo(
    () => sortProjectRows(filterProjectRows(inScope, draft), sort.sort, sort.direction),
    [inScope, draft, sort]
  )
  const summary = useMemo(() => summarizeProjectRows(rows), [rows])

  // Caseta de căutare apare doar peste prag — sau când tot ea e cea care a redus
  // tabelul, altfel ar dispărea odată cu rândurile pe care le-a filtrat.
  const showSearch = inScope.length > SEARCH_THRESHOLD || draft.length > 0

  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = useCallback((id: string) => {
    setOpen(current => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

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
            {!loading && !error && <SummaryLine summary={summary} />}
          </div>
        </div>

        {!loading && !error && (
          <div className="flex flex-wrap items-center gap-4">
            {showSearch && (
              <label className="relative">
                <span className="sr-only">Caută după proiect sau client</span>
                <Search
                  className="pointer-events-none absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--p-ink-faint)]"
                  aria-hidden
                />
                <input
                  type="search"
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  placeholder="Caută"
                  className="w-40 border-0 border-b border-[var(--p-border)] bg-transparent py-1 pl-6 text-sm text-[var(--p-ink)] placeholder:text-[var(--p-ink-faint)] focus:border-[var(--p-accent)] focus:outline-none focus:ring-0"
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
      ) : rows.length === 0 ? (
        draft ? (
          <EmptyState
            title="Niciun proiect găsit"
            description={`Nimic nu se potrivește cu „${draft}”, nici în titlu, nici la client.`}
            action={
              <button
                type="button"
                onClick={() => setDraft('')}
                className="text-sm font-medium text-[var(--p-accent)] underline underline-offset-2"
              >
                Șterge căutarea
              </button>
            }
          />
        ) : (
          <EmptyState
            title={allRows.length === 0 ? 'Niciun proiect' : 'Niciun proiect în lucru'}
            description={
              allRows.length === 0
                ? 'Aici apar toate proiectele din platformă, de îndată ce se creează primul.'
                : 'Toate proiectele sunt încheiate. Pornește comutatorul de mai sus ca să le vezi.'
            }
          />
        )
      ) : (
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--p-border)]">
                {COLUMNS.map(column => {
                  const active = sort.sort === column.key
                  const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`px-3 pb-2 font-normal ${column.numeric ? 'text-right' : 'text-left'}`}
                    >
                      <button
                        type="button"
                        title={column.hint}
                        onClick={() => syncUrl(next => writeProjectSort(next, nextProjectSort(sort, column.key)))}
                        className={`group inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)] ${
                          active
                            ? 'font-semibold text-[var(--p-ink)]'
                            : 'text-[var(--p-ink-faint)] hover:text-[var(--p-ink-soft)]'
                        }`}
                      >
                        {column.label}
                        {/* Săgeata de sortare apare la nevoie: șase iconițe
                            permanente ar fi fost cel mai zgomotos lucru din tabel. */}
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
            <tbody>
              {rows.map(row => (
                <ProjectRow
                  key={row.id}
                  row={row}
                  open={open.has(row.id)}
                  onToggle={() => toggle(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Cifrele de deasupra tabelului, într-o singură propoziție scurtă. Nu carduri
 * mari: Home are deja indicatorii lui, iar două seturi ar începe să se
 * contrazică. Culoare doar pe depășiri — restul e text.
 */
function SummaryLine({ summary }: { summary: DashboardSummary }) {
  const pieces: { text: string; danger?: boolean }[] = [
    { text: countLabel(summary.projects, 'proiect', 'proiecte') },
    summary.overdue > 0
      ? {
          text: `${countLabel(summary.overdue, 'depășit', 'depășite')} în ${countLabel(
            summary.projectsWithOverdue,
            'proiect',
            'proiecte'
          )}`,
          danger: true,
        }
      : { text: 'niciun termen depășit' },
  ]
  if (summary.dueSoon > 0) pieces.push({ text: `${summary.dueSoon} săptămâna asta` })
  if (summary.waitingUs > 0) pieces.push({ text: `${summary.waitingUs} ${WAITING_LABELS.us}` })

  return (
    <p className="text-xs text-[var(--p-ink-soft)]">
      {pieces.map((piece, index) => (
        <Fragment key={piece.text}>
          {index > 0 && <span className="mx-2 text-[var(--p-ink-faint)]">·</span>}
          <span className={piece.danger ? 'text-[var(--p-danger)]' : undefined}>{piece.text}</span>
        </Fragment>
      ))}
    </p>
  )
}

/** „de o zi", „de 12 zile", „de 21 de zile" — vechimea de sub numărul roșu. */
function overdueAge(days: number): string {
  return days === 1 ? 'de o zi' : `de ${countLabel(days, 'zi', 'zile')}`
}

const FAINT = 'text-[var(--p-ink-faint)]'
/** Al doilea rând al unei celule: lămurirea cifrei de deasupra. */
const NOTE = `block text-[11px] leading-tight ${FAINT}`

function ProjectRow({
  row,
  open,
  onToggle,
}: {
  row: ProjectDashboardRow
  open: boolean
  onToggle: () => void
}) {
  const relative = formatRelativeDeadline(row.next_deadline)
  const detailsId = `detalii-${row.id}`

  // „Mâine" e deja pe rândul de deasupra; al doilea termen din aceeași
  // săptămână e cel care schimbă imaginea, deci numărul apare de la două în sus.
  const weekNote = row.due_soon > 1 ? `${row.due_soon} săptămâna asta` : null

  // Cât din munca rămasă nu e prinsă de nicio dată. Fără el, celula de deasupra
  // spune „20 aug." și lasă impresia unui proiect planificat, când termenul acela
  // poate fi singurul din cincizeci de elemente.
  const undatedNote =
    row.undated > 0 ? `${countLabel(row.undated, 'neplanificat', 'neplanificate')}` : null

  const deadlineNote = [relative, weekNote, undatedNote].filter(Boolean).join(' · ')

  return (
    <Fragment>
      {/* Rândul desface detaliile; titlul rămâne singurul drum către proiect.
          Un rând care ar face amândouă ar fi însemnat două înțelesuri pentru
          același clic, în funcție de unde nimerește. */}
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-[var(--p-border)] transition-colors hover:bg-[var(--p-surface-2)] ${
          open ? 'bg-[var(--p-surface-2)]' : ''
        }`}
      >
        <td className="py-3 pl-1 pr-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={event => { event.stopPropagation(); onToggle() }}
              aria-expanded={open}
              // Doar cât rândul chiar există: `aria-controls` către un id
              // absent e o referință ruptă pentru cititoarele de ecran.
              aria-controls={open ? detailsId : undefined}
              aria-label={`${open ? 'Ascunde' : 'Arată'} termenele proiectului ${row.title}`}
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:text-[var(--p-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)] ${FAINT}`}
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
            </button>

            <Link
              href={`/projects/${row.id}`}
              // Titlul e un link adevărat, ca ecranul să rămână accesibil de la
              // tastatură și proiectul să se poată deschide în tab nou.
              onClick={event => event.stopPropagation()}
              className="font-medium text-[var(--p-ink)] underline-offset-4 hover:underline"
            >
              {row.title}
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

        <td className="px-3 py-3 text-[var(--p-ink-soft)]">
          {row.client_name ?? <span className={FAINT}>—</span>}
        </td>

        <td
          className="px-3 py-3 text-right tabular-nums"
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

        <td className="px-3 py-3 text-right">
          {row.waiting_us + row.waiting_client === 0 ? (
            <span className={FAINT}>—</span>
          ) : (
            <>
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
            </>
          )}
        </td>

        <td className="px-3 py-3">
          {row.next_deadline === null ? (
            <>
              <span className={FAINT}>Fără termen</span>
              {undatedNote && <span className={NOTE}>{undatedNote}</span>}
            </>
          ) : (
            <>
              <span className="text-[var(--p-ink)]">{formatShortDate(row.next_deadline)}</span>
              {deadlineNote && <span className={NOTE}>{deadlineNote}</span>}
            </>
          )}
        </td>

        <td className="px-3 py-3 text-right">
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
      </tr>

      {open && (
        <tr id={detailsId} className="border-b border-[var(--p-border)] bg-[var(--p-surface-2)]">
          <td colSpan={COLUMNS.length} className="px-3 pb-5 pt-1">
            <ProjectDetails row={row} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/**
 * Rândul desfășurat: chiar elementele din spatele numerelor, cu responsabil și
 * link direct. Nicio cerere nouă — termenele sunt deja în memorie, aduse ca să
 * poată fi numărate.
 */
function ProjectDetails({ row }: { row: ProjectDashboardRow }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <DetailList
          title="Depășite"
          events={row.overdue_events}
          tone="danger"
          empty="Niciun termen depășit."
          moreHref={projectCalendarHref(row.id, { overdueOnly: true })}
        />
        <DetailList
          title="Urmează"
          events={row.upcoming_events}
          empty="Niciun termen viitor."
          moreHref={projectCalendarHref(row.id)}
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-xs text-[var(--p-ink-soft)]">
        <p>
          {/* Aceleași numere, desfăcute pe sursă: raportul din rând e dominat de
              documente, deci singur nu spune dacă munca internă a avansat. */}
          Activități {row.activities.done}/{row.activities.total}
          <span className="mx-2 text-[var(--p-ink-faint)]">·</span>
          Documente {row.requests.done}/{row.requests.total}
          {row.drafts > 0 && (
            <>
              <span className="mx-2 text-[var(--p-ink-faint)]">·</span>
              {countLabel(row.drafts, 'element', 'elemente')} în pregătire, invizibile clientului
            </>
          )}
        </p>

        <span className="flex flex-wrap items-center gap-5">
          <Link href={`/projects/${row.id}`} className="text-[var(--p-accent)] hover:underline">
            Deschide proiectul
          </Link>
          <Link href={projectCalendarHref(row.id)} className="text-[var(--p-accent)] hover:underline">
            Vezi în calendar
          </Link>
        </span>
      </div>
    </div>
  )
}

function DetailList({
  title,
  events,
  empty,
  moreHref,
  tone,
}: {
  title: string
  events: CalendarEvent[]
  empty: string
  moreHref: string
  tone?: 'danger'
}) {
  const shown = events.slice(0, DETAIL_LIMIT)
  const rest = events.length - shown.length

  return (
    <section aria-label={title}>
      <h3 className="flex items-baseline gap-2 px-1 pb-1 text-[11px] uppercase tracking-[0.08em]">
        <span className={tone === 'danger' ? 'text-[var(--p-danger)]' : 'text-[var(--p-ink-faint)]'}>{title}</span>
        {events.length > 0 && <span className="text-[var(--p-ink-faint)] normal-case">{events.length}</span>}
      </h3>

      {shown.length === 0 ? (
        <p className="px-1 py-3 text-xs text-[var(--p-ink-faint)]">{empty}</p>
      ) : (
        <>
          {/* Același rând ca în lista de termene a calendarului, nu o copie a
              lui: aceleași culori, aceleași etichete, același link. */}
          <ul className="divide-y divide-[var(--p-border)] overflow-hidden rounded-lg bg-[var(--p-surface)]">
            {shown.map(event => (
              // Fără pastila de stare: în „Depășite" ar fi scris „Depășit" pe
              // fiecare rând, iar în „Urmează", „În lucru" — antetul listei o
              // spune deja o singură dată.
              <EventRow key={`${event.kind}-${event.id}`} event={event} withProgress={false} />
            ))}
          </ul>

          {rest > 0 && (
            <Link
              href={moreHref}
              className="mt-1.5 inline-flex items-center gap-1 px-1 text-xs text-[var(--p-accent)] hover:underline"
            >
              și încă {countLabel(rest, 'termen', 'termene')}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </>
      )}
    </section>
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
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
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
