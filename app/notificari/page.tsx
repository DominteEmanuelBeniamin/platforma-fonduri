'use client'

import { AlertCircle, Bell, CheckCheck, LoaderCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useNotifications } from '@/app/providers/NotificationsProvider'
import NotificationRow from '@/components/notifications/NotificationRow'
import SelectFilter from '@/components/SelectFilter'
import { LocationStrip } from '@/components/ui/LocationStrip'
import { Button } from '@/components/ui/Button'
import {
  useNotificationFeed,
  type NotificationFilters,
  type NotificationItem,
} from '@/components/notifications/useNotificationFeed'
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS, notificationDayGroup } from '@/lib/notification-display'
import { Spinner } from '@/components/ui/Spinner'

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
        <Spinner />
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
    <div className="flex flex-col">
      <LocationStrip
        segments={[{ label: 'Bonie', href: '/' }, { label: 'Notificări' }]}
        action={
          <Button variant="secondary" aria-label="Marchează toate notificările ca citite" onClick={() => void markAllRead()} disabled={busy || unreadCount === 0}>
            {markingAll ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">Marchează tot ca citit</span>
            <span className="sm:hidden">Citește tot</span>
          </Button>
        }
      />

      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">Notificări</h1>
      <p className="mb-6 mt-2 text-sm text-ink-soft">
        {unreadCount > 0 ? `${unreadCount} necitite` : 'Toate sunt citite.'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-[var(--radius-plate)] border border-rule bg-plate p-0.5" role="group" aria-label="Filtru după stare">
          <button
            type="button"
            onClick={() => setFilters((current) => ({ ...current, status: 'all' }))}
            aria-pressed={filters.status === 'all'}
            className={`min-h-11 rounded-[1px] px-3 text-sm font-semibold transition-colors duration-[120ms] sm:min-h-9 ${filters.status === 'all' ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : 'text-ink-soft hover:text-ink'}`}
          >
            Toate
          </button>
          <button
            type="button"
            onClick={() => setFilters((current) => ({ ...current, status: 'unread' }))}
            aria-pressed={filters.status === 'unread'}
            className={`min-h-11 rounded-[1px] px-3 text-sm font-semibold transition-colors duration-[120ms] sm:min-h-9 ${filters.status === 'unread' ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent-ink)]' : 'text-ink-soft hover:text-ink'}`}
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
        <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-[var(--radius-plate)] border border-rule bg-plate text-center">
          <AlertCircle className="h-8 w-8" style={{ color: 'var(--sg-danger)' }} aria-hidden="true" />
          <p className="text-sm font-semibold text-ink">Notificările nu au putut fi încărcate.</p>
          <button type="button" onClick={() => void feed.reload()} className="min-h-11 text-sm font-semibold text-[var(--sg-accent)] underline-offset-4 hover:underline sm:min-h-9">
            Încearcă din nou
          </button>
        </div>
      ) : feed.loading && feed.items.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center text-sm text-ink-soft" role="status">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Se încarcă notificările…
        </div>
      ) : feed.items.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-[var(--radius-plate)] border border-dashed border-rule-strong text-center">
          <Bell className="h-8 w-8 text-ink-faint" aria-hidden="true" />
          <p className="text-sm font-semibold text-ink">
            {hasFilter ? 'Nu există notificări pentru filtrele selectate.' : 'Nu ai notificări.'}
          </p>
          {hasFilter ? (
            <button
              type="button"
              onClick={() => setFilters({ status: 'all', type: '', projectId: '' })}
              className="min-h-11 text-sm font-semibold text-[var(--sg-accent)] underline-offset-4 hover:underline sm:min-h-9"
            >
              Șterge filtrele
            </button>
          ) : (
            <p className="max-w-[52ch] text-sm leading-relaxed text-ink-soft">
              Aici vor apărea publicări, atribuiri, termene și acțiuni sau verificări de documente.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-ink">{group.label}</h2>
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
              className="mx-auto inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-plate)] border border-rule bg-plate px-4 text-sm font-semibold text-ink-soft transition-colors duration-[120ms] hover:border-rule-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-55 sm:min-h-10"
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
