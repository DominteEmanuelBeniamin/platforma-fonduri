'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Bell, CheckCheck, LoaderCircle, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useNotifications } from '@/app/providers/NotificationsProvider'
import NotificationRow from '@/components/notifications/NotificationRow'
import { useNotificationFeed } from '@/components/notifications/useNotificationFeed'
import { IconButton } from '@/components/ui/IconButton'
import { Counter } from '@/components/ui/Counter'

const PANEL_SIZE = 8

type ProjectOption = { id: string; title: string }

type ProjectsResponse = {
  projects?: Array<{ id?: string; title?: string | null }>
}

export default function NotificationsBell() {
  const { apiFetch } = useAuth()
  const { unreadCount } = useNotifications()
  const [open, setOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState('')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const feed = useNotificationFeed({
    limit: PANEL_SIZE,
    active: open,
    filters: { status: 'all', type: '', projectId: projectFilter },
  })
  const [markingAll, setMarkingAll] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    void apiFetch('/api/projects', { method: 'GET' })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json() as Promise<ProjectsResponse>
      })
      .then((payload) => {
        if (cancelled || !payload || !Array.isArray(payload.projects)) return
        setProjects(payload.projects
          .filter((project): project is { id: string; title?: string | null } => typeof project?.id === 'string')
          .map((project) => ({
            id: project.id,
            title: project.title?.trim() || 'Proiect fără titlu',
          }))
          .sort((left, right) => left.title.localeCompare(right.title, 'ro')))
      })
      .catch(() => undefined)

    return () => { cancelled = true }
  }, [apiFetch, open])

  // Panoul e o privire scurtă; controalele complete rămân pe pagina de notificări.
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setProjectFilter('')
      feed.reset()
    }
  }

  const markAllRead = async () => {
    setMarkingAll(true)
    await feed.setRead(null, true)
    setMarkingAll(false)
  }

  const busy = markingAll || feed.pendingId !== null

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `${unreadCount} notificări necitite` : 'Notificări'}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-plate)] border border-rule text-ink-soft transition-colors duration-[120ms] hover:border-rule-strong hover:bg-paper-sunk hover:text-ink pointer-fine:h-9 pointer-fine:w-9"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <Counter n={unreadCount} className="absolute -right-1 -top-1 h-4 min-w-4 text-[10px] ring-2 ring-[var(--sg-plate)]" />
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999998]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-[999999] flex max-h-[min(80dvh,36rem)] flex-col overflow-hidden rounded-t-[var(--radius-plate-lg)] border border-rule bg-plate focus:outline-none sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-[min(28rem,calc(100vw-2rem))] sm:rounded-[var(--radius-plate-lg)]"
          style={{ boxShadow: 'var(--sg-lift)' }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-ink">Notificări</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-ink-soft">
                {unreadCount > 0 ? `${unreadCount} necitite` : 'Nimic nou'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton type="button" label="Închide notificările">
                <X className="h-4 w-4" />
              </IconButton>
            </Dialog.Close>
          </div>

          {projects.length > 1 && (
            <div className="border-b border-rule px-5 py-3 sm:px-6">
              <label className="block">
                <span className="sr-only">Filtrează după proiect</span>
                <select
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}
                  className="h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-2.5 text-sm font-medium text-ink transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-9"
                >
                  <option value="">Toate proiectele</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
                </select>
              </label>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">
            {feed.error ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
                <AlertCircle className="h-8 w-8" style={{ color: 'var(--sg-danger)' }} aria-hidden="true" />
                <p className="text-sm font-semibold text-ink">Notificările nu au putut fi încărcate.</p>
                <button type="button" onClick={() => void feed.reload()} className="text-sm font-semibold text-[var(--sg-accent)] underline-offset-4 hover:underline">Încearcă din nou</button>
              </div>
            ) : feed.loading && feed.items.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center text-sm text-ink-soft" role="status">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Se încarcă notificările…
              </div>
            ) : feed.items.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
                <Bell className="h-8 w-8 text-ink-faint" aria-hidden="true" />
                <p className="text-sm font-semibold text-ink">Nu ai notificări</p>
                <p className="max-w-xs text-sm leading-relaxed text-ink-soft">Aici apar publicările, atribuirile, termenele și verificările de documente.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {feed.items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    disabled={busy}
                    onOpen={(current) => void feed.openTarget(current)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-rule px-5 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={busy || unreadCount === 0}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors duration-[120ms] hover:text-[var(--sg-accent)] disabled:cursor-not-allowed disabled:opacity-55 sm:min-h-9"
            >
              {markingAll ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              Marchează tot ca citit
            </button>
            <Link
              href="/notificari"
              onClick={() => handleOpenChange(false)}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--sg-accent)] underline-offset-4 hover:underline sm:min-h-9"
            >
              Vezi toate
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
