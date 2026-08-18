'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowDown, ArrowUp, ChevronsUpDown, LayoutDashboard, Loader2 } from 'lucide-react'

import {
  buildProjectDashboardRows,
  formatRelativeDeadline,
  formatShortDate,
  nextProjectSort,
  readProjectSort,
  readShowEnded,
  sortProjectRows,
  writeProjectSort,
  writeShowEnded,
  type CalendarPayload,
  type ProjectColumnKey,
  type ProjectDashboardRow,
} from '@/lib/calendar'
import { useAuth } from '@/app/providers/AuthProvider'

const COLUMNS: { key: ProjectColumnKey; label: string; numeric?: boolean }[] = [
  { key: 'project', label: 'Proiect' },
  { key: 'client', label: 'Client' },
  { key: 'done', label: 'Finalizate', numeric: true },
  { key: 'deadline', label: 'Următorul termen' },
  { key: 'overdue', label: 'Depășite', numeric: true },
]

/**
 * Tabloul de bord al administratorului (cerința 23): toate proiectele, cât din
 * fiecare e finalizat, următorul termen și câte termene sunt depășite.
 *
 * Ecran separat de Home în mod deliberat. Home răspunde la „ce necesită atenție
 * acum" și o face cu carduri; ăsta răspunde la „cum stă fiecare proiect" și o
 * face cu un tabel. Forma diferă ca deosebirea să fie vizibilă, nu doar
 * conceptuală.
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
  // Sortarea și comutatorul trăiesc în URL, ca un tabel sortat să se poată trimite
  // mai departe ca link. Optimismul de mai jos e cel din `CalendarSurface`: ce
  // scriem se vede pe loc, dar cade de îndată ce URL-ul ajunge altundeva (Back,
  // un link deschis în pagină), ca să nu rămână controale care arată altceva
  // decât spune adresa.
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

  // ─── Derivate ───────────────────────────────────────────────────────────────

  const allRows = useMemo(() => (payload ? buildProjectDashboardRows(payload) : []), [payload])
  const endedCount = useMemo(() => allRows.filter(row => !row.active).length, [allRows])
  const rows = useMemo(() => {
    const visible = showEnded ? allRows : allRows.filter(row => row.active)
    return sortProjectRows(visible, sort.sort, sort.direction)
  }, [allRows, showEnded, sort])

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
    <div className="project-scope space-y-4">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--p-accent-soft)]">
          <LayoutDashboard className="h-5 w-5 text-[var(--p-accent)]" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold text-[var(--p-ink)]">Tablou de bord</h1>
          <p className="text-xs text-[var(--p-ink-soft)]">
            Toate proiectele, cu cât din fiecare e finalizat și cu termenele care urmează.
          </p>
        </div>
      </header>

      {/* Numărătoarea și comutatorul apar doar peste un tabel adevărat: altfel
          ar sta un „0 proiecte" deasupra unei erori sau a unui spinner. */}
      {!loading && !error && (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--p-ink)]">
          {rows.length} {rows.length === 1 ? 'proiect' : 'proiecte'}
        </p>

        {/* Comutatorul apare numai când chiar ascunde ceva: altfel ar fi un
            control care nu face nimic vizibil pe toată platforma. */}
        {(endedCount > 0 || showEnded) && (
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--p-ink-soft)]">
            <input
              type="checkbox"
              checked={showEnded}
              onChange={event => {
                const checked = event.target.checked
                syncUrl(next => writeShowEnded(next, checked))
              }}
              className="h-3.5 w-3.5 rounded border-[var(--p-border-strong)] text-[var(--p-accent)] focus:ring-[var(--p-accent)]"
            />
            Arată și proiectele încheiate
            {!showEnded && endedCount > 0 && (
              <span className="text-[var(--p-ink-faint)]">({endedCount})</span>
            )}
          </label>
        )}
      </div>
      )}

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
        <EmptyState
          title={allRows.length === 0 ? 'Niciun proiect' : 'Niciun proiect în lucru'}
          description={
            allRows.length === 0
              ? 'Aici apar toate proiectele din platformă, de îndată ce se creează primul.'
              : 'Toate proiectele sunt încheiate. Pornește comutatorul de mai sus ca să le vezi.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)]">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--p-border)] bg-[var(--p-surface-2)]">
                {COLUMNS.map(column => {
                  const active = sort.sort === column.key
                  const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`px-4 py-2.5 ${column.numeric ? 'text-right' : 'text-left'}`}
                    >
                      <button
                        type="button"
                        onClick={() => syncUrl(next => writeProjectSort(next, nextProjectSort(sort, column.key)))}
                        className={`inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent)] ${
                          active ? 'text-[var(--p-accent)]' : 'text-[var(--p-ink-soft)] hover:text-[var(--p-ink)]'
                        }`}
                      >
                        {column.label}
                        <Icon
                          className={`h-3 w-3 ${active ? '' : 'text-[var(--p-ink-faint)]'}`}
                          aria-hidden
                        />
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--p-border)]">
              {rows.map(row => (
                <ProjectRow key={row.id} row={row} onOpen={() => router.push(`/projects/${row.id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ProjectRow({ row, onOpen }: { row: ProjectDashboardRow; onOpen: () => void }) {
  const relative = formatRelativeDeadline(row.next_deadline)

  return (
    <tr onClick={onOpen} className="cursor-pointer transition-colors hover:bg-[var(--p-surface-2)]">
      <td className="px-4 py-3">
        <Link
          href={`/projects/${row.id}`}
          // Rândul întreg e apăsabil, dar titlul rămâne un link adevărat: altfel
          // ecranul n-ar fi accesibil de la tastatură.
          onClick={event => event.stopPropagation()}
          className="font-medium text-[var(--p-ink)] underline-offset-2 hover:underline"
        >
          {row.title}
        </Link>
        {!row.active && (
          <span className="ml-2 rounded-full bg-[var(--p-draft-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--p-draft)]">
            Încheiat
          </span>
        )}
      </td>

      <td className="px-4 py-3 text-[var(--p-ink-soft)]">
        {row.client_name ?? <span className="text-[var(--p-ink-faint)]">Fără client</span>}
      </td>

      <td className="px-4 py-3 text-right tabular-nums">
        {row.total === 0 ? (
          <span className="text-[var(--p-ink-faint)]">Fără elemente</span>
        ) : (
          <span className={row.done === row.total ? 'font-semibold text-[var(--p-success)]' : 'text-[var(--p-ink)]'}>
            {row.done}/{row.total}
          </span>
        )}
      </td>

      <td className="px-4 py-3">
        {row.next_deadline === null ? (
          <span className="text-[var(--p-ink-faint)]">Fără termen</span>
        ) : (
          <span className="text-[var(--p-ink)]">
            {formatShortDate(row.next_deadline)}
            {relative && <span className="ml-1.5 text-xs text-[var(--p-ink-faint)]">{relative}</span>}
          </span>
        )}
      </td>

      <td className="px-4 py-3 text-right tabular-nums">
        {row.overdue === 0 ? (
          <span className="text-[var(--p-ink-faint)]">0</span>
        ) : (
          <span className="font-bold text-[var(--p-danger)]">{row.overdue}</span>
        )}
      </td>
    </tr>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--p-border-strong)] px-6 py-12 text-center">
      <LayoutDashboard className="h-8 w-8 text-[var(--p-ink-faint)]" aria-hidden />
      <h3 className="font-display text-base font-semibold text-[var(--p-ink)]">{title}</h3>
      <p className="max-w-sm text-sm text-[var(--p-ink-soft)]">{description}</p>
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
