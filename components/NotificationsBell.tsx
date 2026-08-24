'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Bell, CalendarClock, FileCheck, FileText, FileX, LoaderCircle, Megaphone, MessageSquare, Upload, UserRoundCheck, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useNotifications } from '@/app/providers/NotificationsProvider'
import { useToast } from '@/app/providers/ToastProvider'

type NotificationItem = {
  id: string
  projectId: string
  projectTitle: string | null
  type: string
  entityType: string
  entityId: string
  title: string
  itemCount: number
  createdAt: string
  readAt: string | null
}

type NotificationsResponse = {
  items?: NotificationItem[]
  nextCursor?: string | null
  error?: string
}

type StatusFilter = 'all' | 'unread'

type NotificationVisual = {
  Icon: typeof Bell
  iconClassName: string
}

function notificationVisual(item: NotificationItem): NotificationVisual {
  const title = item.title.trim().toLocaleLowerCase('ro-RO')

  if (item.type === 'publication') return { Icon: Megaphone, iconClassName: 'bg-emerald-100 text-emerald-600' }
  if (item.type === 'assignment') return { Icon: UserRoundCheck, iconClassName: 'bg-indigo-100 text-indigo-600' }
  if (item.type === 'deadline') {
    const overdue = title.startsWith('termen depășit') || title.startsWith('termene depășite')
    return overdue
      ? { Icon: AlertCircle, iconClassName: 'bg-red-100 text-red-600' }
      : { Icon: CalendarClock, iconClassName: 'bg-amber-100 text-amber-700' }
  }
  if (item.type === 'document_action') {
    if (title.startsWith('document aprobat')) return { Icon: FileCheck, iconClassName: 'bg-emerald-100 text-emerald-600' }
    if (title.startsWith('document respins')) return { Icon: FileX, iconClassName: 'bg-red-100 text-red-600' }
    if (title.startsWith('document încărcat') || title.startsWith('documente încărcate')) {
      return { Icon: Upload, iconClassName: 'bg-blue-100 text-blue-600' }
    }
    return { Icon: FileText, iconClassName: 'bg-violet-100 text-violet-600' }
  }
  return { Icon: MessageSquare, iconClassName: 'bg-slate-100 text-slate-500' }
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })
}

function itemLabel(item: NotificationItem) {
  if (item.type === 'publication') {
    const label = item.itemCount === 1 ? 'Element nou publicat' : 'Elemente noi publicate'
    return item.itemCount > 1 ? `${label} (${item.itemCount})` : label
  }
  if (item.itemCount > 1) return `${item.title} (${item.itemCount})`
  return item.title
}

export default function NotificationsBell() {
  const { apiFetch } = useAuth()
  const { unreadCount, refresh } = useNotifications()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [projectFilter, setProjectFilter] = useState('')
  const [items, setItems] = useState<NotificationItem[]>([])
  const [projectCatalog, setProjectCatalog] = useState<Array<{ id: string; title: string }>>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [navigatingId, setNavigatingId] = useState<string | null>(null)
  const requestSequence = useRef(0)

  const loadPage = useCallback(async (replace: boolean, cursor: string | null = null) => {
    const sequence = ++requestSequence.current
    setLoading(true)
    if (replace) setError(false)

    try {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      if (projectFilter) params.set('projectId', projectFilter)
      if (statusFilter === 'unread') params.set('unreadOnly', 'true')

      const res = await apiFetch(`/api/notifications?${params.toString()}`, { method: 'GET' })
      const json = (await res.json().catch(() => null)) as NotificationsResponse | null
      if (!res.ok) throw new Error(json?.error || 'Nu am putut încărca notificările.')
      if (sequence !== requestSequence.current) return

      const incoming = Array.isArray(json?.items) ? json.items : []
      setProjectCatalog((current) => {
        const byId = new Map(current.map((project) => [project.id, project.title]))
        for (const item of incoming) {
          if (!byId.has(item.projectId)) byId.set(item.projectId, item.projectTitle || 'Proiect fără titlu')
        }
        return Array.from(byId, ([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title, 'ro'))
      })
      setItems((current) => {
        const merged = replace ? incoming : [...current, ...incoming]
        return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      })
      setNextCursor(json?.nextCursor ?? null)
    } catch {
      if (sequence === requestSequence.current) setError(true)
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [apiFetch, projectFilter, statusFilter])

  useEffect(() => {
    if (!open) return
    void loadPage(true)
  }, [loadPage, open, projectFilter, statusFilter])

  const closePanel = useCallback(async () => {
    requestSequence.current += 1
    setItems([])
    setProjectCatalog([])
    setNextCursor(null)
    setError(false)
    setLoading(false)
    setStatusFilter('all')
    setProjectFilter('')

    try {
      const res = await apiFetch('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      if (!res.ok) showToast('Nu am putut marca notificările ca citite.', 'error')
    } catch {
      showToast('Nu am putut marca notificările ca citite.', 'error')
    } finally {
      await refresh()
    }
  }, [apiFetch, refresh, showToast])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setOpen(true)
      return
    }
    if (!open) return
    setOpen(false)
    void closePanel()
  }

  const openTarget = async (item: NotificationItem) => {
    if (navigatingId) return
    setNavigatingId(item.id)
    try {
      const res = await apiFetch(`/api/notifications/${encodeURIComponent(item.id)}/target`, { method: 'GET' })
      const json = (await res.json().catch(() => null)) as { href?: string; error?: string } | null
      if (res.status === 404) {
        showToast('Ținta acestei notificări nu mai există.', 'error')
        return
      }
      if (!res.ok || !json?.href) {
        showToast('Nu am putut deschide notificarea.', 'error')
        return
      }
      setOpen(false)
      await closePanel()
      const targetUrl = new URL(json.href, window.location.origin)
      if (targetUrl.href === window.location.href) {
        window.location.reload()
      } else {
        window.location.assign(targetUrl.href)
      }
    } catch {
      showToast('Nu am putut deschide notificarea.', 'error')
    } finally {
      setNavigatingId(null)
    }
  }

  const hasFilter = statusFilter === 'unread' || !!projectFilter
  const emptyMessage = hasFilter ? 'Nu există notificări pentru filtrele selectate.' : 'Nu ai notificări.'

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `${unreadCount} notificări necitite` : 'Notificări'}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999998] bg-slate-950/25 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[999999] flex h-[min(88dvh,42rem)] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl focus:outline-none sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-4 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[min(28rem,calc(100vw-2rem))] sm:rounded-3xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-slate-900">Notificări</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-slate-500">Actualizări despre proiectele tale.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Închide notificările" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 sm:px-6">
            <div className="flex items-center rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Filtru notificări">
              <button type="button" onClick={() => setStatusFilter('all')} aria-pressed={statusFilter === 'all'} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${statusFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Toate</button>
              <button type="button" onClick={() => setStatusFilter('unread')} aria-pressed={statusFilter === 'unread'} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${statusFilter === 'unread' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Necitite</button>
            </div>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Filtrează după proiect</span>
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option value="">Toate proiectele</option>
                {projectCatalog.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">
            {error ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                <AlertCircle className="h-8 w-8 text-rose-400" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-700">Notificările nu au putut fi încărcate.</p>
                <button type="button" onClick={() => void loadPage(true)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Încearcă din nou</button>
              </div>
            ) : loading && items.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center text-sm text-slate-400"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Se încarcă notificările…</div>
            ) : items.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                <Bell className="h-8 w-8 text-slate-300" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-600">{emptyMessage}</p>
                {!hasFilter && <p className="max-w-xs text-xs leading-relaxed text-slate-400">Aici vor apărea publicări, atribuiri, termene și acțiuni sau verificări de documente.</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((item) => {
                  const { Icon, iconClassName } = notificationVisual(item)
                  return (
                    <button key={item.id} type="button" disabled={navigatingId !== null} onClick={() => void openTarget(item)} className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${item.readAt ? 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50' : 'border-violet-100 bg-violet-50/50 hover:border-violet-200 hover:bg-violet-50'}`}>
                      <span className="flex items-start gap-3">
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-snug text-slate-800">{itemLabel(item)}</span>
                          <span className="mt-1 block truncate text-xs text-slate-500">{item.projectTitle || 'Proiect fără titlu'}</span>
                          <span className="mt-1 block text-[11px] text-slate-400">{formatDate(item.createdAt)}</span>
                        </span>
                        {!item.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" aria-label="Necitită" />}
                      </span>
                    </button>
                  )
                })}
                {nextCursor && (
                  <button type="button" disabled={loading} onClick={() => void loadPage(false, nextCursor)} className="mt-1 inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    Încarcă mai multe
                  </button>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
