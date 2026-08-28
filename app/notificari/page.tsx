'use client'

import { AlertCircle, ArrowLeft, Bell, CheckCheck, LoaderCircle } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useNotifications } from '@/app/providers/NotificationsProvider'
import NotificationRow from '@/components/notifications/NotificationRow'
import SelectFilter from '@/components/SelectFilter'
import {
  useNotificationFeed,
  type NotificationFilters,
  type NotificationItem,
} from '@/components/notifications/useNotificationFeed'
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS, notificationDayGroup } from '@/lib/notification-display'

type DayGroup = { label: string; items: NotificationItem[] }

/** Rândurile vin deja sortate descrescător, așa că grupurile ies în ordine. */
function groupByDay(items: NotificationItem[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const item of items) {
    const label = notificationDayGroup(item.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

export default function NotificationsPage() {
  const router = useRouter()
  const { loading: authLoading, token, apiFetch } = useAuth()
  const { unreadCount } = useNotifications()
  const [filters, setFilters] = useState<NotificationFilters>({ status: 'all', type: '', projectId: '' })
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([])
  const [markingAll, setMarkingAll] = useState(false)
  const active = !authLoading && !!token
  const feed = useNotificationFeed({ active, filters, paginate: true })

  useEffect(() => {
    if (authLoading) return
    if (!token) router.push('/login')
  }, [authLoading, router, token])

  // Proiectele vin din lista celor la care ai acces, nu din notificările deja
  // încărcate: altfel filtrul ar oferi doar proiectele nimerite în prima
  // pagină, iar un proiect fără notificări n-ar putea fi nici măcar întrebat.
  useEffect(() => {
    if (!active) return
    let cancelled = false

    void apiFetch('/api/projects', { method: 'GET' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json) return
        const list = Array.isArray(json.projects) ? json.projects : []
        setProjects(list
          .map((project: { id: string; title: string | null }) => ({
            id: project.id,
            title: project.title || 'Proiect fără titlu',
          }))
          .sort((a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'ro')))
      })
      .catch(() => undefined)

    return () => { cancelled = true }
  }, [active, apiFetch])

  if (authLoading || !token) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-100 border-t-indigo-600" />
      </div>
    )
  }

  const busy = markingAll || feed.pendingId !== null
  const hasFilter = filters.status === 'unread' || !!filters.type || !!filters.projectId
  const groups = groupByDay(feed.items)

  const markAllRead = async () => {
    setMarkingAll(true)
    await feed.setRead(null, true)
    setMarkingAll(false)
  }

  return (
    <div className="fade-in-up flex flex-col gap-6">
      <div className="flex items-center gap-4 border-b border-slate-200/60 pb-6">
        <Link
          href="/"
          aria-label="Înapoi"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Notificări</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {unreadCount > 0 ? `${unreadCount} necitite` : 'Toate notificările sunt citite'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={busy || unreadCount === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-200"
        >
          {markingAll ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Marchează tot ca citit</span>
          <span className="sm:hidden">Citește tot</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Filtru după stare">
          <button
            type="button"
            onClick={() => setFilters((current) => ({ ...current, status: 'all' }))}
            aria-pressed={filters.status === 'all'}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${filters.status === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Toate
          </button>
          <button
            type="button"
            onClick={() => setFilters((current) => ({ ...current, status: 'unread' }))}
            aria-pressed={filters.status === 'unread'}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${filters.status === 'unread' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Necitite
          </button>
        </div>

        {/* Același dropdown ca în restul aplicației. */}
        <SelectFilter
          value={filters.type}
          onChange={(value) => setFilters((current) => ({ ...current, type: value }))}
          placeholder="Toate categoriile"
          ariaLabel="Filtrează după categorie"
          options={NOTIFICATION_TYPES.map((type) => ({ value: type, label: NOTIFICATION_TYPE_LABELS[type] }))}
        />

        {/* Cu un singur proiect nu e nimic de ales: filtrul ar fi un control
            care nu face nimic. */}
        {projects.length > 1 && (
          <SelectFilter
            value={filters.projectId}
            onChange={(value) => setFilters((current) => ({ ...current, projectId: value }))}
            placeholder="Toate proiectele"
            ariaLabel="Filtrează după proiect"
            className="flex-1 sm:max-w-xs"
            options={projects.map((project) => ({ value: project.id, label: project.title }))}
          />
        )}
      </div>

      {feed.error ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200/60 bg-white text-center">
          <AlertCircle className="h-8 w-8 text-rose-400" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-700">Notificările nu au putut fi încărcate.</p>
          <button type="button" onClick={() => void feed.reload()} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            Încearcă din nou
          </button>
        </div>
      ) : feed.loading && feed.items.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center text-sm text-slate-400">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Se încarcă notificările…
        </div>
      ) : feed.items.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200/60 bg-white text-center">
          <Bell className="h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-600">
            {hasFilter ? 'Nu există notificări pentru filtrele selectate.' : 'Nu ai notificări.'}
          </p>
          {hasFilter ? (
            <button
              type="button"
              onClick={() => setFilters({ status: 'all', type: '', projectId: '' })}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Șterge filtrele
            </button>
          ) : (
            <p className="max-w-sm text-xs leading-relaxed text-slate-400">
              Aici vor apărea publicări, atribuiri, termene și acțiuni sau verificări de documente.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">{group.label}</h2>
              {group.items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  disabled={busy}
                  onOpen={(current) => void feed.openTarget(current)}
                  onToggleRead={(current) => void feed.setRead([current.id], !current.readAt)}
                  onDismiss={(current) => void feed.dismiss([current.id])}
                />
              ))}
            </section>
          ))}

          {feed.hasMore && (
            <button
              type="button"
              onClick={feed.loadMore}
              disabled={feed.loading}
              className="mx-auto inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              {feed.loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              Încarcă mai multe
            </button>
          )}
        </div>
      )}
    </div>
  )
}
